# Pipeline Orchestrator (Sub-project 2) — Design

## Goal

Replace the linear "click parse → click generate tests → click generate rubric → click run → click improve" UX with a single agent run that drives the whole pipeline. The agent picks tools, tracks budget, and stops on score / iteration cap / token budget.

## Scope decisions

V1 (this spec):
- In-memory orchestrator state (per-request)
- Linear pipeline tools (parse, tests, rubric, run) + reuse the 7 improver tools
- Voluntary `early_stop` tool
- Budget tracking from AI SDK `result.usage`
- Score + iteration + token budget stop condition
- Toggle in SpecForm switches to agent mode

V2 (deferred):
- `clarify_with_user` tool with SSE pause/resume + KV state persistence
- Cross-pollination polish

## Architecture

```
src/lib/agent/
  types.ts           ← extend: OrchestratorEvent, OrchBudget, OrchestratorState
  planner.ts         ← extend: accept tool-set parameter
  loop.ts            ← reuse for inner improver phase
  triggers.ts        ← reuse
  tools/
    index.ts         ← extend: buildToolRegistry({ ctx, mode })
    parseSpec.ts     ← NEW
    generateTests.ts ← NEW
    generateRubric.ts← NEW
    runEvalTool.ts   ← NEW
    earlyStop.ts     ← NEW
    (existing 7 improver tools — reused)
  orchestrator.ts    ← NEW: outer async generator
  budget.ts          ← NEW: track tokens from result.usage

src/app/api/orchestrate/route.ts ← NEW: SSE
src/components/SpecForm.tsx      ← extend: agent-mode toggle
src/components/OrchestratorPanel.tsx ← NEW: transcript + final scorecard
src/lib/pageReducer.ts           ← extend: 'orchestrate' stage
src/app/page.tsx                 ← branch on agent-mode
```

## Tool surface

11 tools total in agent mode:

Pipeline (5 new):
- `parse_spec` → returns ParsedSpec, sets `state.parsed`
- `generate_tests` → returns TestCase[], sets `state.tests`
- `generate_rubric` → returns Rubric, sets `state.rubric`
- `run_eval_now` → runs full evaluation, returns Summary, sets results + summary
- `early_stop` → terminates orchestration with `stop` reason

Improver (6 reused; `rerun_eval` becomes redundant in agent mode but kept):
- `diagnose_failures`, `add_tests`, `add_adversarial_tests`, `revise_rubric`, `tighten_rubric_descriptors`, `rewrite_test`

The planner sees the full set; system prompt explains: "first build the pipeline state, then improve it."

## Stop conditions

Stop the orchestrator when ANY of:
- `state.summary.overall >= threshold` AND every dimension `>= threshold`
- iterations `>= maxIterations` (default 12)
- `budget.spentTokens >= budget.capTokens` (default 250k input + output combined)
- planner called `early_stop`
- request aborted

## Budget tracking

`generateText` returns `result.usage` (`promptTokens`, `completionTokens`, `totalTokens`). The orchestrator increments `budget.spent*` after each planner call. Tool execution that itself calls Gemini (the four pipeline tools) returns its usage too — orchestrator aggregates.

## State

```ts
type OrchestratorState = {
  parsed?: ParsedSpec;
  tests?: TestCase[];
  rubric?: Rubric;
  results?: EvalResult[];
  summary?: Summary;
  history: OrchIteration[];
  budget: OrchBudget;
};

type OrchBudget = {
  capTokens: number;
  capIterations: number;
  capScoreThreshold: number;  // e.g. 0.8
  spentTokens: number;
  iterations: number;
};
```

Each iteration the planner sees the current state (omitting heavy fields when not needed) and chooses one tool. Tool result includes `public` (for SSE) and `stateUpdate` (merged in).

## Events

```ts
type OrchestratorEvent =
  | { type: 'orch-started'; budget: OrchBudget }
  | { type: 'orch-iteration'; n: number }
  | { type: 'orch-tool-call'; name: string; args: unknown }
  | { type: 'orch-tool-result'; name: string; public: unknown }
  | { type: 'orch-budget'; spentTokens: number; iterations: number }
  | { type: 'orch-state'; parsed?: ParsedSpec; tests?: TestCase[]; rubric?: Rubric; summary?: Summary }
  | { type: 'orch-done'; reason: 'all-pass'|'iteration-cap'|'budget-cap'|'early-stop'; finalState: OrchestratorState }
  | { type: 'orch-error'; message: string }
  | { type: 'orch-aborted' };
```

## UI

`SpecForm` gains a toggle: "Run as agent (experimental)". When ON, clicking submit calls `/api/orchestrate` instead of `/api/parse-spec` and the page renders an `OrchestratorPanel` showing the transcript + live scorecard. When OFF, behavior is unchanged.

## Testing

- Unit: each pipeline tool, budget accounting, orchestrator stop logic
- Integration: orchestrator with mocked planner driving a happy-path sequence
- Existing 79 tests must keep passing
