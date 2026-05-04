# Post-Run Improver Agent — Design Spec

**Date:** 2026-05-04
**Status:** Draft for review
**Owner:** EvalForge
**Sub-project:** Agentic Layer 1 of 3 (Post-run improver → Pipeline orchestrator → Continuous critic)

## Goal

Add an autonomous agent that improves a low-scoring eval run after `run-eval` completes. The user clicks "Improve with agent"; the agent loops up to 5 times, picking from 7 tools to add tests, refine the rubric, or rewrite weak descriptors, then re-runs the evaluation. A snapshot taken at loop start guarantees the run cannot get worse — if the final overall score regresses, the snapshot is restored automatically.

This is the first of three agentic surfaces. It builds the primitives (tool registry, planner, loop, snapshot, SSE event schema) that Sub-projects 2 and 3 will reuse.

## Non-goals

- Pipeline orchestration (Sub-project 2)
- Cross-run pattern detection or persistence (Sub-project 3)
- Approval gates per tool call (chose fully-autonomous path)
- Multi-agent coordination
- Persisting agent runs across page refresh
- Generic agent framework extraction (do that after Sub-project 2 ships)

## Decisions captured (from brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Trigger style | Post-run improver: agent runs after `run-eval` completes |
| 2 | Trigger condition + tool surface | Both score-level and dimension-level triggers; full toolbelt of 7 tools |
| 3 | Autonomy | Fully autonomous (no per-step approval gates) |
| 4 | Stop condition | Iteration cap (5) + improvement check (stop if weakest dim improves <0.05 across 2 consecutive iterations) |
| 5 | State model | Snapshot at loop start; auto-rollback if final overall score regresses |
| 6 | Planner infra | Vercel AI SDK v6 + AI Gateway; Pro for planner, Flash-Lite for tool sub-LLMs |
| 7 | UI surface | Inline below the existing `Scorecard` |
| 8 | Loop architecture | Imperative loop with AI SDK `generateText({ tools })` per iteration |

## Architecture

```
src/lib/agent/
  types.ts            ← AgentEvent, AgentState, ToolName, Snapshot
  snapshot.ts         ← takeSnapshot, restoreSnapshot, diffSnapshots — pure
  triggers.ts         ← shouldTrigger, shouldStop — pure predicates
  planner.ts          ← buildPlannerPrompt, callPlanner
  tools/
    index.ts          ← TOOLS registry (Zod schemas + handlers)
    diagnose.ts       ← diagnose_failures(dimensionId)
    addTests.ts       ← add_tests(n, focusDimensionId?)
    addAdversarial.ts ← add_adversarial_tests(category)
    reviseRubric.ts   ← revise_rubric(reason)
    tightenDescriptors.ts ← tighten_rubric_descriptors(dimensionId)
    rewriteTest.ts    ← rewrite_test(testId, reason)
    rerunEval.ts      ← rerun_eval()
  loop.ts             ← runAgentLoop(input, signal): AsyncGenerator<AgentEvent>

src/app/api/improve/
  route.ts            ← thin SSE adapter

src/lib/
  runEval.ts          ← NEW: extracted from /api/run-eval/route.ts (judgeOne + runBatched)
  pageReducer.ts      ← MODIFIED: add 'improve' stage (snapshot, transcript, diff, rollback)
  types.ts            ← MODIFIED: re-export AgentEvent for UI
  gemini.ts           ← UNCHANGED: existing generateJSON keeps working

src/components/
  AgentPanel.tsx      ← renders below Scorecard; transcript + diff + rollback
  AgentTranscript.tsx ← scrollable list of agent steps
  AgentDiff.tsx       ← shows tests added/changed, rubric dims tightened, score delta
```

**Module responsibilities:**

- **`types.ts`** — types only, no logic. Single source of truth for `AgentEvent` discriminated union.
- **`snapshot.ts`** — `Snapshot = { tests, rubric, results, summary }`. Pure.
- **`triggers.ts`** — pure predicates. Trivially unit-testable.
- **`planner.ts`** — builds planner prompt from current state + history, calls `generateText({ model, tools, messages })`, returns the chosen `ToolCall`. The only LLM-facing layer for planning.
- **`tools/`** — each tool in its own file: `{ description, inputSchema, execute }`. Adding an 8th tool = new file + entry in `tools/index.ts`.
- **`loop.ts`** — pure conductor. Takes inputs, yields events. No SSE, no fetch, no React. Tests iterate the generator directly.
- **`route.ts`** — thin SSE adapter, mirrors `/api/run-eval/route.ts`.
- **`runEval.ts`** — extracted helper so both the route and the agent's `rerun_eval` tool can call it.

**Why this shape.** Every file has one clear purpose. Loop logic is testable without HTTP. Tools are independently editable. Mirrors existing `src/lib/` patterns (`scoring.ts`, `runBatched.ts`, `refinement.ts`).

## Trigger logic

After `run-eval` finishes, the existing `Scorecard` renders an "Improve with agent" CTA when:

```ts
shouldTrigger(summary: RunSummary, threshold = 0.7): boolean
  → summary.overall < threshold OR
    summary.dimensions.some(d => d.score < threshold)
```

Threshold is hardcoded to 0.7 for v1. Made configurable later.

## Stop logic

```ts
shouldStop(history: AgentIteration[], threshold = 0.7): StopReason | null
```

Returns one of:

- `'all-pass'` — every dimension ≥ threshold AND overall ≥ threshold
- `'iteration-cap'` — 5 iterations completed
- `'no-improvement'` — last 2 iterations' weakest-dim score deltas both < 0.05
- `null` — keep going

Order matters: `all-pass` checked first (success), then `iteration-cap`, then `no-improvement`.

## Snapshot + rollback

```ts
type Snapshot = {
  tests: TestCase[];
  rubric: Rubric;
  results: EvalResult[];
  summary: RunSummary;
};

takeSnapshot(state: AgentState): Snapshot          // structuredClone
restoreSnapshot(snap: Snapshot): AgentState        // returns clone
diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff
```

`SnapshotDiff` shape:
```ts
type SnapshotDiff = {
  testsAdded: TestCase[];
  testsRemoved: TestCase[];        // empty in v1; tools never delete tests
  testsChanged: { before: TestCase; after: TestCase }[];
  rubricDimensionsChanged: { id: string; beforeDescriptor: string; afterDescriptor: string; weightDelta: number }[];
  overallDelta: number;            // after.overall - before.overall
  perDimensionDelta: { id: string; delta: number }[];
};
```

**Rollback rule.** When the loop ends, if `final.summary.overall < snapshot.summary.overall`, the loop emits `'rolled-back'` and the route returns the snapshot as the final state. Otherwise the loop emits `'committed'` and the agent state is returned as-is.

**Manual rollback.** The UI also exposes a "Restore previous" button after a successful loop. The page reducer keeps the snapshot in `improve.snapshot` until the user starts a new improve run or runs the evaluation again.

## Planner

**Prompt shape:**

```
You are an eval-improvement agent. The user has run an evaluation and the score
is low. Your job: pick the next tool that will most likely improve the weakest
dimensions.

Current state:
- Spec domain: {parsed.domain}
- Overall score: {summary.overall}
- Threshold: {threshold}
- Per-dimension scores: {summary.dimensions}
- Test count: {tests.length}
- Iteration: {iteration} / {maxIterations}

Recent history:
{history of (toolCall, scoreDelta) pairs}

Available tools:
{auto-generated from TOOLS registry}

Choose ONE tool to call. Always re-measure with rerun_eval after a mutation
before choosing the next mutation.
```

**Model:** `google/gemini-2.5-pro` via AI Gateway. Single tool call per iteration (`stopWhen: stepCountIs(1)` or AI SDK's natural stop after one tool decision).

**Output:** AI SDK returns the tool name, args, and result of the tool's `execute()` function. The loop owns deciding whether to keep going.

## Tool contracts

```ts
type AgentState = {
  parsed: ParsedSpec;
  tests: TestCase[];
  rubric: Rubric;
  results: EvalResult[];
  summary: RunSummary;
};
```

Each tool entry: `tool({ description, inputSchema (Zod), execute })`. Handlers receive `(args, { state })` via AI SDK's `experimental_context` (or equivalent) and return both the structured result *and* the new partial state to merge.

| Tool | Mutates | Input | Output |
|------|---------|-------|--------|
| `diagnose_failures` | none | `{ dimensionId }` | `{ patterns: string[], suggestedActions: string[] }` |
| `add_tests` | `tests` | `{ n: 1-10, focusDimensionId? }` | `{ added: TestCase[] }` |
| `add_adversarial_tests` | `tests` | `{ category: 'injection' \| 'edge-case' \| 'ambiguous-input' \| 'out-of-scope' }` | `{ added: TestCase[] }` |
| `revise_rubric` | `rubric` | `{ reason }` | `{ revisedRubric: Rubric, changedDimensions: string[] }` |
| `tighten_rubric_descriptors` | `rubric` | `{ dimensionId }` | `{ before: string, after: string }` |
| `rewrite_test` | `tests` | `{ testId, reason }` | `{ before: TestCase, after: TestCase }` |
| `rerun_eval` | `results`, `summary` | `{}` | `{ results: EvalResult[], summary: RunSummary }` |

**Conventions:**

- No tool calls another tool. Only the planner orchestrates.
- No tool calls `rerun_eval` itself. Re-measurement is always a separate tool call so its cost is visible in the transcript and the loop can compute deltas cleanly.
- Mutating tools generate new content via existing helpers (`generateJSON`, `runRefinement`); we do not re-implement generation.
- Sub-LLM calls inside tools use `google/gemini-2.5-flash-lite` via the gateway. Only the planner uses Pro.

## Loop algorithm

```ts
async function* runAgentLoop(
  input: { parsed, tests, rubric, results, summary, threshold = 0.7, maxIterations = 5 },
  signal: AbortSignal
): AsyncGenerator<AgentEvent> {
  const startSnap = takeSnapshot(input);
  yield { type: 'started', snapshot: startSnap, threshold, maxIterations };

  let state: AgentState = { ...input };
  const history: AgentIteration[] = [];
  const messages: ModelMessage[] = [];
  let stoppedReason: StopReason | null = null;

  for (let i = 1; i <= maxIterations; i++) {
    if (signal.aborted) { yield { type: 'aborted' }; return; }

    yield { type: 'iteration-start', iteration: i };

    yield { type: 'planner-thinking', iteration: i };
    const plan = await callPlanner({ state, history, messages, iteration: i, signal });
    yield { type: 'tool-call', iteration: i, name: plan.toolName, args: plan.args };

    const toolResult = plan.result;
    state = applyStateUpdate(state, toolResult.stateUpdate);
    yield { type: 'tool-result', iteration: i, name: plan.toolName, result: toolResult.public };

    const iter: AgentIteration = {
      iteration: i,
      toolName: plan.toolName,
      args: plan.args,
      result: toolResult.public,
      summaryAfter: state.summary,
      weakestDeltaSinceLast: computeDelta(history, state.summary),
    };
    history.push(iter);
    messages.push(toMessage(plan, toolResult));

    const reason = shouldStop(history, input.threshold);
    yield { type: 'iteration-end', iteration: i };
    if (reason) {
      stoppedReason = reason;
      break;
    }
  }

  yield { type: 'loop-end', reason: stoppedReason ?? 'iteration-cap', finalSummary: state.summary };

  const regressed = state.summary.overall < startSnap.summary.overall;
  if (regressed) {
    yield { type: 'rolled-back', reason: 'overall-regressed', restored: startSnap };
  } else {
    const diff = diffSnapshots(startSnap, takeSnapshot(state));
    yield { type: 'committed', finalState: state, diff };
  }
}
```

**AI SDK integration note.** AI SDK's `tool({ execute })` returns whatever `execute` returns; the loop treats the return as `{ public, stateUpdate }`. Tools that mutate state never touch `state` directly — they return `stateUpdate` describing what to apply. This keeps tools pure-ish (input → output) and the loop in charge of state transitions.

## SSE event schema

```ts
type AgentEvent =
  | { type: 'started'; snapshot: Snapshot; threshold: number; maxIterations: number }
  | { type: 'iteration-start'; iteration: number }
  | { type: 'planner-thinking'; iteration: number }
  | { type: 'tool-call'; iteration: number; name: ToolName; args: unknown }
  | { type: 'tool-result'; iteration: number; name: ToolName; result: unknown }
  | { type: 'iteration-end'; iteration: number }
  | { type: 'loop-end'; reason: 'all-pass' | 'iteration-cap' | 'no-improvement'; finalSummary: RunSummary }
  | { type: 'committed'; finalState: AgentState; diff: SnapshotDiff }
  | { type: 'rolled-back'; reason: 'overall-regressed'; restored: Snapshot }
  | { type: 'aborted' }
  | { type: 'error'; message: string };
```

Frame format identical to existing SSE routes: `data: ${JSON.stringify(event)}\n\n`.

## Route: `POST /api/improve`

Body shape:
```ts
{ parsed: ParsedSpec; tests: TestCase[]; rubric: Rubric; results: EvalResult[]; summary: RunSummary }
```

Validation mirrors `/api/run-eval/route.ts` (`isParsed`, `isRubric`, `isTests`, plus new `isResults`, `isSummary` guards).

Response: `text/event-stream`. Iterates `runAgentLoop(...)` and frames each event.

`runtime = 'nodejs'`, `maxDuration = 300`.

## UI integration

**`AgentPanel`** — rendered below `Scorecard` when `runState.phase === 'done'`. States:

1. **Idle** — shows "Improve with agent" button + a one-line summary of why it's available ("3 dimensions below 0.7"). Hidden if `shouldTrigger` returns false.
2. **Running** — button replaced with `AgentTranscript` showing live `tool-call` / `tool-result` rows. Cancel button.
3. **Done — committed** — `AgentDiff` shows score delta + tests/rubric changes + "Restore previous" button.
4. **Done — rolled back** — banner: "Improvement attempt regressed the score. Original state restored." + a "View attempted changes" expand for transparency.
5. **Error** — failure message + retry button.

**`AgentTranscript`** — chronological list. Each row: iteration #, tool name, short arg summary, status (pending/done), short result summary. Click row to expand full args/result JSON.

**`AgentDiff`** — three sections:
- Score delta (overall + per-dim, color-coded green/red)
- Tests added (count + expandable list of new test inputs)
- Rubric changes (per dimension: descriptor before/after diff, weight delta)

## Page reducer changes

Add `improve` to `StageKey` and a new shape on `state.stages.improve`:

```ts
type ImproveStageState =
  | { phase: 'idle' }
  | { phase: 'running'; events: AgentEvent[]; snapshot: Snapshot | null }
  | { phase: 'done-committed'; diff: SnapshotDiff; finalState: AgentState; snapshot: Snapshot }
  | { phase: 'done-rolled-back'; restored: Snapshot; attemptedDiff: SnapshotDiff }
  | { phase: 'error'; message: string };
```

Actions:
- `IMPROVE_START` — phase → 'running'; snapshot = null until `started` event arrives
- `IMPROVE_EVENT` — appends to `events`, transitions phase on `committed`/`rolled-back`/`error`
- `IMPROVE_RESTORE` — manual restore; replaces page-level `tests`, `rubric`, `results`, `summary` with snapshot
- `IMPROVE_RESET` — clears improve stage; runs when user starts a new run-eval

## Refactor surfaced

Extract `judgeOne` + `runBatched` block from `/api/run-eval/route.ts:88-127` into `src/lib/runEval.ts`:

```ts
// src/lib/runEval.ts
export async function runEval(
  parsed: ParsedSpec,
  rubric: Rubric,
  tests: TestCase[],
  options: { signal?: AbortSignal; onProgress?: (completed: number) => void } = {},
): Promise<{ results: EvalResult[]; summary: RunSummary }>
```

The route becomes a thin SSE wrapper around this. The `rerun_eval` tool calls it directly. Pure mechanical lift, no behavior change.

## Dependencies

New packages:
- `ai` (Vercel AI SDK v6) — agent loop + tool calling
- `zod` — already a transitive dep; we add direct usage for tool schemas

Use AI Gateway's plain provider strings (e.g. `'google/gemini-2.5-pro'`) — preferred per Vercel guidance, no provider-specific package needed.

Env vars:
- `AI_GATEWAY_API_KEY` — AI Gateway key, used by AI SDK by default

## Testing

### Unit tests

- **`triggers.test.ts`** — exhaustive truth tables for `shouldTrigger` (all-above, mixed, all-below) and `shouldStop` (all-pass, cap, no-improvement-at-iter-2/3/4, normal continue).
- **`snapshot.test.ts`** — `takeSnapshot` deep-clones; `restoreSnapshot` returns clone; `diffSnapshots` correctly identifies added/changed tests, descriptor changes, weight deltas, score deltas.
- **`tools/*.test.ts`** — one test file per tool. Mock `generateJSON` and `runRefinement`. Verify each tool's `execute` returns the right `{ public, stateUpdate }` shape and doesn't mutate inputs.
- **`planner.test.ts`** — mock AI SDK's `generateText`; verify prompt content includes domain, summary, history; verify return shape.
- **`loop.test.ts`** — drive the generator with a stub planner. Assert event sequence for: (a) all-pass after 1 iter, (b) iteration-cap, (c) no-improvement stop, (d) regression triggers rollback, (e) abort signal aborts cleanly.
- **`runEval.test.ts`** — verify the extracted helper preserves the route's behavior (mock Gemini, assert results + summary).

### Integration tests

- **`improve-route.test.ts`** — POST to `/api/improve`, mock AI SDK + Gemini, verify the SSE event sequence matches expected agent flow end-to-end.

### Existing tests

- `/api/run-eval/route.ts` tests must continue passing after the `runEval` extraction. No behavior change.

## Token / cost budget

- Planner: Pro, ~2k input tokens × 5 iterations = ~10k input tokens per loop run.
- Mutation tools (Flash-Lite): existing per-call costs, ~3-7 calls per loop.
- `rerun_eval`: 20 tests × Flash-Lite = same as a normal eval run, ~5 calls per loop max.

Estimated worst-case cost per Improve run: **~$0.05-0.10**. Documented in user-facing tooltip on the Improve button.

## Risk register

| Risk | Mitigation |
|------|------------|
| Planner picks pathological tool sequences (e.g. add 100 tests then never re-measure) | Iteration cap + per-tool input bounds (`add_tests` capped at 10) + no-improvement check |
| AI SDK tool calling fails mid-loop | Catch in loop, emit `error` event, return last good state |
| `rerun_eval` exceeds Vercel's 300s function limit | Same `concurrency: 2, gapMs: 4000` from existing run-eval; 20 tests fits comfortably in 300s |
| Agent improves overall but worsens a critical dim | Rollback only triggers on overall regression; we accept this as v1 trade-off (manual restore covers it) |
| AI Gateway key missing in env | Route returns 500 with clear message; checked in route validation, not at module load |
| User runs Improve twice and the second run uses stale snapshot | `IMPROVE_START` clears prior snapshot; new snapshot taken at loop start |

## Success criteria

- All unit + integration tests pass
- Run the legal eval (Round 1 v3) → click Improve → score lifts ≥0.05 overall in ≥4/5 attempts
- Auto-rollback triggers cleanly in a synthetic "make things worse" test (mock planner that always picks `add_adversarial_tests('out-of-scope')`)
- Latency: each iteration < 30s wall-clock; full 5-iter loop < 4 min on a 20-test eval
- No regression in existing `/api/run-eval` tests
- AgentPanel renders correctly in all 5 states (idle, running, committed, rolled-back, error)

## Rollout

Single PR off `dev`. Deploy preview → smoke-test (legal eval improve cycle) → merge to `main` → production deploy.

## Sub-projects 2 and 3 — what this enables

- **Sub-project 2 (Pipeline orchestrator)** reuses `tools/`, `planner.ts`, `loop.ts`, and `AgentEvent` schema. Adds new tools like `parse_spec`, `clarify_with_user`, `early_stop_pipeline`. Replaces the linear `parse → tests → rubric → run` with an agent-driven plan.
- **Sub-project 3 (Continuous critic)** reuses everything plus a persistence layer (Vercel storage / KV) and a cron trigger. The critic agent reads a user's run history and proposes improvements proactively.
