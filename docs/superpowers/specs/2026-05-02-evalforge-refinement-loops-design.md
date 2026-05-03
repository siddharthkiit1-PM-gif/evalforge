# EvalForge — Refinement Loops Design (Sub-project 1)

**Status:** Draft for review
**Date:** 2026-05-02
**Branch:** `feat/refinement-loops`
**Predecessor:** Plan B (generation pipeline) shipped on `main` at `f651a11`.
**Successor:** Sub-project 2 (Exemplar library + retrieval).

---

## Goal

Turn each of the three pipeline stages (`parse-spec`, `generate-tests`, `generate-rubric`) from a single Gemini call into a bounded **`generate → critique → revise`** loop. The result feels meaningfully more intelligent — categorization is sharper, coverage is enforced, vague outputs are caught — without adding any new infrastructure (no DB, no embeddings, no queue).

This is the substrate on which Sub-projects 2–4 layer (exemplar retrieval, domain classification, quality gating).

---

## Non-goals

- Model fine-tuning of any kind.
- New external services (DB, vector store, queue, observability sink).
- Mid-stream resume after disconnect.
- Multi-spec history / saved runs.
- Real Gemini calls in CI.
- Cost optimization beyond bounded N.

---

## Locked-in design choices

| Question | Choice |
|---|---|
| Which stages get refinement? | **All 3** (parse-spec, generate-tests, generate-rubric). |
| Iteration model | **Bounded loop**, exits early when critique returns no major issues. |
| Max iterations | **N = 2** (max 5 Gemini calls per stage in worst case). |
| UX visibility | **Granular sub-status + streamed intermediate output** (B+C). |
| Streaming protocol | **Server-Sent Events (SSE)** over POST. |
| Critique model | Same Gemini 2.5 Flash as generation (no upgrade in v1). |
| Stage execution | **Sequential** (parse → tests → rubric). |
| Telemetry | **Server-side `console.log` JSON** to Vercel Logs. No external sink. |

---

## Architecture

### New shared module: `src/lib/refinement.ts`

Pure orchestration. Takes `(generate, critique, revise)` async functions plus a stage label and yields `RefinementEvent`s. The loop logic — early exit on no major issues, N=2 cap, error propagation — is written and tested **once** here. Each route handler plugs into this generator.

### Route handler refactor (×3)

Each `src/app/api/<stage>/route.ts` returns:

```ts
return new Response(stream, {
  headers: {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  },
});
```

Inside, the route consumes the refinement generator and writes one `data: <json>\n\n` frame per event. Closes the stream after `done` (or `error`).

### `lib/gemini.ts` — already sufficient

`generateJSON<T>(prompt)` already exists (lines 49-61): wraps `withRetry` (429 backoff), calls Gemini, runs `extractJSON`. Used identically by generate/critique/revise. **No changes required.**

### `lib/prompts.ts` extension

Each stage gains two siblings (9 builders total):

- `<stage>CritiquePrompt(input, output) → string` — instructs the model to return `{ issues: Issue[] }`.
- `<stage>RevisePrompt(currentOutput, issues) → string` — instructs the model to fix listed issues, preserve everything else.

### Page reducer rewrite: `lib/pageReducer.ts`

```ts
type StageState<T> = {
  phase: 'idle' | 'generating' | 'critiquing' | 'revising' | 'done' | 'error';
  pass: 0 | 1 | 2;
  current: T | null;          // latest output, re-rendered live
  issues: Issue[];            // last critique result
};

type State = {
  stages: {
    parse: StageState<ParsedSpec>;
    tests: StageState<TestSuite>;
    rubric: StageState<Rubric>;
  };
  error: { stage: 'parse'|'tests'|'rubric'; message: string; recoverable: boolean } | null;
};

type Action =
  | { type: 'STAGE_START'; stage: keyof State['stages'] }
  | { type: 'STAGE_EVENT'; stage: keyof State['stages']; event: RefinementEvent<unknown> }
  | { type: 'STAGE_ERR'; stage: keyof State['stages']; message: string; recoverable: boolean }
  | { type: 'RESET' };
```

### Page client refactor: `src/app/page.tsx`

`runPipeline(spec)` becomes:

```ts
const parsed = await runStage('/api/parse-spec', { spec }, 'parse');
const tests = await runStage('/api/generate-tests', { parsedSpec: parsed }, 'tests');
const rubric = await runStage('/api/generate-rubric', { parsedSpec: parsed }, 'rubric');
```

Where `runStage<T>` opens an SSE connection (POST + `fetch().body.getReader()`), parses `data:` frames, dispatches each as `STAGE_EVENT`, and resolves with the `done` event's payload.

### Status messages (computed from reducer)

- `phase === 'generating'` → `"Generating <stage>…"`
- `phase === 'critiquing'` → `"Critiquing <stage> (pass {pass+1}/2)…"`
- `phase === 'revising'` → `"Revising <stage> (pass {pass}/2)…"`
- `phase === 'done'` → next stage's status, or `"Ready. Plan C wires the runner."` for rubric.

### Live re-render

`TestSuiteTable` and `RubricPanel` already read their data from props. Each `revised` event mutates `stages.<x>.current`; React re-renders. Zero component changes for live update.

### What stays unchanged

- `ParsedSpec`, `TestSuite`, `Rubric` schemas in `lib/types.ts`.
- `DomainBadge`, `TestSuiteTable`, `RubricPanel` components.
- `SpecForm`, `SpecInput`, `examples.ts`.
- Plan B's existing 70 tests (some get extended; none deleted).

---

## Data flow & SSE event schema

### Pipeline lifecycle

```
Client                                Routes                    Gemini
──────                                ──────                    ──────
 click "Generate"
 │
 ├─ POST /api/parse-spec ────────►  open SSE
 │   (body: { spec })                ├─ generate ────────────► call #1 → ParsedSpec v0
 │   ◄── data: {generated, v0}       │
 │   ◄── data: {critiquing,pass:1}   ├─ critique ────────────► call #2 → {issues}
 │   ◄── data: {critiqued, issues}   │
 │   ◄── data: {revising,pass:1}     ├─ revise ──────────────► call #3 → ParsedSpec v1
 │   ◄── data: {revised, v1}         │
 │                                   ├─ critique ────────────► call #4 → {issues:[]}
 │   ◄── data: {critiqued,issues:[]} │   (clean → exit loop)
 │   ◄── data: {done, final}         └─ stream closes
 │
 ├─ POST /api/generate-tests ────►  (same pattern, body { parsedSpec })
 │
 └─ POST /api/generate-rubric ───►  (same pattern, body { parsedSpec })

 final state: parsed-spec card → 20-row test table → 4-6 dim rubric
 status: "Ready. Plan C wires the runner."
```

Three sequential SSE connections, not one mega-stream. Failure in one stage aborts the chain.

### Event schema (`src/lib/refinement.ts`)

```ts
type RefinementEvent<T> =
  | { type: 'generated';  pass: 0;          output: T }
  | { type: 'critiquing'; pass: 1 | 2 }                            // status only
  | { type: 'critiqued';  pass: 1 | 2;      issues: Issue[] }
  | { type: 'revising';   pass: 1 | 2 }                            // status only
  | { type: 'revised';    pass: 1 | 2;      output: T }
  | { type: 'done';                          output: T }            // final, locked
  | { type: 'error';                         message: string };

type Issue = {
  field: string;                     // e.g. "tests[3].category"
  severity: 'minor' | 'major';
  description: string;
  suggestion: string;
};
```

Wire format (one event per SSE message):

```
data: {"type":"generated","pass":0,"output":{...}}\n\n
data: {"type":"critiquing","pass":1}\n\n
data: {"type":"critiqued","pass":1,"issues":[{...}]}\n\n
...
data: {"type":"done","output":{...}}\n\n
```

### Client consumption

We do **not** use `EventSource` — it forces GET. Plain `fetch().body.getReader()` plus a small SSE-frame parser (~20 lines) supports POST.

### Reducer event mapping

| Event/Action | Reducer effect |
|---|---|
| `STAGE_START` (client-dispatched when SSE opens) | `phase = 'generating'`, `pass = 0`, `current = null`, `issues = []` |
| `generated` | `current = output`, `pass = 0` (phase stays `'generating'` — flips on next event) |
| `critiquing` | `phase = 'critiquing'`, `pass = event.pass` |
| `critiqued` | Store `issues`. If any `severity === 'major'`, phase stays `'critiquing'` (next event will be `revising`). If none, `phase = 'done'` and we await the `done` event for the locked output. |
| `revising` | `phase = 'revising'`, `pass = event.pass` |
| `revised` | `current = output`, `pass = event.pass` (phase stays `'revising'`) |
| `done` | `phase = 'done'`, `current = event.output`, lock |
| `error` | `phase = 'error'`, abort pipeline, set root `error` |

---

## Critique prompt design

The whole feature lives or dies on critique quality. The contract has to be **specific, structured, and enumerable** — issues become a checklist the revise prompt walks.

### Issue shape (shared)

```json
{
  "field": "tests[3].category",
  "severity": "major",
  "description": "Labeled 'happy path' but missing time-tracking data, which makes it untestable.",
  "suggestion": "Reclassify as 'edge case' or add an explicit time field."
}
```

`{ "issues": [] }` means clean — loop exits.

### Per-stage critique checklists (inlined in each prompt)

**Parse-spec critique** (against actual `ParsedSpec` shape `{feature, inputs, outputs, constraints, domain}`):

1. **Domain correctness** — `domain` is one of `legal | sales | healthcare | general` and matches the spec's actual subject.
2. **Feature summary fidelity** — `feature` is a faithful one-line summary; no facts absent from the spec.
3. **Inputs completeness** — every distinct input the AI receives, per the spec, is in `inputs`.
4. **Outputs completeness** — every distinct output the AI produces, per the spec, is in `outputs`.
5. **Constraints completeness** — every requirement/rule the output must satisfy is in `constraints`.
6. **No hallucination** — no item in `inputs`/`outputs`/`constraints` is unsupported by the spec.
7. **Granularity** — items are 1-6 short, specific bullets per list; no duplicates.

**Generate-tests critique** (against actual `TestCase` shape `{id, category, input, notes?}` with categories `happy_path | edge_case | adversarial`):

1. **Count** — exactly 20 tests with IDs `test-01`…`test-20`.
2. **Category distribution** — roughly 8 `happy_path`, 7 `edge_case`, 5 `adversarial` (per existing generation prompt). Tolerance ±1.
3. **Concrete inputs** — every `input` is a literal string the feature would receive, not a description, placeholder, or meta-language ("This test checks…").
4. **Coverage of `inputs`** — every item in the parsed spec's `inputs` is exercised by ≥1 test.
5. **Coverage of `constraints`** — every item in `constraints` is probed by ≥1 test (positive or violation).
6. **Adversarial validity** — `adversarial` tests actually attempt to break the agent (prompt injection, jailbreak, contradictory instructions, hostile input, ambiguous phrasing) — *not* merely informal phrasing or typos.
7. **Realism / voice variety** — inputs resemble real user phrasing; tone/length/register varies across the 20.
8. **Specificity** — no input so vague the agent's behavior can't be evaluated.

**Generate-rubric critique** (against actual `Rubric` shape `{dimensions: [{id, label, description, weight}]}`):

1. **Dimension count** — between 4 and 6.
2. **Weights** — every `weight ∈ [0, 1]`; sum equals 1.0 within ±0.01.
3. **ID format** — every `id` is kebab-case.
4. **Independence** — dimensions don't overlap; no two score the same thing.
5. **Measurability** — each `description` provides scorable criteria, not opinion.
6. **Coverage of `constraints`** — every item in the parsed spec's `constraints` is reflected in ≥1 dimension.
7. **Domain specificity** — no generic dimensions like "quality" or "helpfulness"; each reflects a real failure mode for this feature.
8. **Naming clarity** — `label` is self-explanatory.

### Revise prompt

```
You generated this output:
<output JSON>

A reviewer found these issues:
- [major] tests[3].category: <description>. Suggestion: <suggestion>.
- [major] tests[7].input: <description>. Suggestion: <suggestion>.

Produce a corrected output that:
1. Fixes EVERY listed issue.
2. Preserves all unflagged content unchanged.
3. Returns the SAME schema shape — no extra fields, no missing fields.

Output the corrected JSON only.
```

Revise prompt **never gets the original spec** — only the previous output + issues. Keeps revisions surgical.

### Loop pseudocode (`lib/refinement.ts`)

```
output = generate()
emit('generated', output)
for pass in 1..N:
  emit('critiquing', pass)
  issues = critique(output)
  emit('critiqued', pass, issues)
  if issues.filter(i => i.severity === 'major').length === 0:
    break
  emit('revising', pass)
  output = revise(output, issues)
  emit('revised', pass, output)
emit('done', output)
```

**Worst case: 5 calls per stage** (gen, crit, rev, crit, rev). 3 stages × 5 = 15 calls per generation.

---

## Error handling

| Failure | Where | Response |
|---|---|---|
| Gemini 429 | `lib/gemini.ts` | Retry with backoff (existing). Loop is unaware. |
| Gemini 5xx / network | Refinement step | Emit `error`, close stream. Pipeline aborts at this stage. |
| Invalid JSON from Gemini | After `extractJSON` | Emit `error`. Don't retry the same call. |
| Critique returns malformed `issues` | In refinement loop | Treat as `{ issues: [] }` and exit loop. Log warning. |
| Revise produces wrong schema | After revise call | Skip this pass — keep prior `output`, exit loop. |
| Vercel 300s function timeout | Stream cuts mid-flight | Client detects truncation (no `done` event) → `error` state with message "took too long". |
| Client disconnects | Server side | `req.signal.aborted` → break loop, close cleanly. No orphaned Gemini calls. |
| Pipeline cascade (parse fails) | Client orchestration | `runStage` rejects → don't open next SSE. Reducer surfaces single error message. |

### Reducer error contract

```ts
error: {
  stage: 'parse' | 'tests' | 'rubric';
  message: string;
  recoverable: boolean;     // true → show "Retry" button; false → show error + suggest reword
} | null;
```

`recoverable: true` for 429-after-retries and network glitches. Retry re-runs from the failed stage with cached upstream outputs.

---

## Telemetry

Server-side `console.log` (Vercel Logs) per stage at `done`:

```ts
console.log(JSON.stringify({
  evt: 'refinement.complete',
  stage: 'tests',
  passes: 1,                  // revise rounds actually run
  initialIssues: 4,           // major issues at pass-0 critique
  finalIssues: 0,             // major issues at exit
  durationMs: 38400,
  tokensIn: 12345,            // from Gemini response.usageMetadata
  tokensOut: 6789,
}));
```

Answers:

- Do refinement loops actually fix issues? (`initialIssues > finalIssues`)
- How often does the second pass help? (`passes` distribution)
- Cost per stage. (`tokens*`)

No external sink — `vercel logs` is enough for v1.

### Cost ceiling

Worst case: 5 calls × 3 stages × ~20k tokens = ~300k tokens per generation. At Gemini 2.5 Flash rates (~$0.075/M in, $0.30/M out), **<$0.05 per run.** Confirmed once via telemetry, then not a v1 concern.

---

## Testing strategy

All Gemini calls mocked — zero network in CI.

| Module | Tests | Approach |
|---|---|---|
| `lib/refinement.ts` | ~10 | Stub generate/critique/revise; assert event order, exit conditions, error propagation. |
| `lib/gemini.ts` | 0 | `generateJSON` already exists and tested. |
| `lib/prompts.ts` | +12 | Snapshot + assertion tests for the 6 new builders. |
| `app/api/<stage>/route.ts` ×3 | ~5 each = 15 | Mock `lib/refinement`; consume the response stream; assert SSE frame sequence. |
| `lib/pageReducer.ts` | +12 | Pure reducer tests for `STAGE_EVENT` and `STAGE_ERR`. |
| `app/page.tsx` integration | ~6 | Mock `fetch` with hand-crafted SSE `ReadableStream`; RTL drives click; assert intermediate + final UI. |

**Shared helper** (`src/test/sse-stream.ts`):

```ts
export function mockSSEStream(events: object[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}
```

Used by both route tests and page integration tests.

**Total new tests:** ~57 on top of existing 70 → ~127 total. Estimated test run ~25-35s.

**Out of scope for tests:**

- Real Gemini calls (manual smoke only, like Plan B's Task 11).
- Token-accurate cost assertions (telemetry shape checked; counts not).
- Performance / latency benchmarks.

---

## Deliberate non-features (v1)

- ❌ Request deduplication (clicking Generate twice → 2 runs).
- ❌ Mid-stream resume.
- ❌ Saved generation history.
- ❌ A/B feature flag between refined and unrefined output.
- ❌ Stronger model for critique (Gemini 2.5 Pro).
- ❌ Parallel test+rubric stages after parse.

These are intentional. Each adds complexity disproportionate to v1 value; revisit in Sub-projects 2–4.

---

## Done-When

- [ ] All 3 routes return SSE streams emitting the documented event schema.
- [ ] `lib/refinement.ts` exists, is unit-tested, used by all 3 routes.
- [ ] All 9 prompt builders exist in `lib/prompts.ts` with snapshot tests.
- [ ] Page reducer handles `STAGE_EVENT` and `STAGE_ERR` correctly.
- [ ] `TestSuiteTable` and `RubricPanel` re-render live as `revised` events arrive.
- [ ] Status text shows the granular phase + pass counter.
- [ ] All ~127 tests pass; lint clean; build clean.
- [ ] Manual smoke: Healthcare/Legal/Sales chips each show the loop UI and produce visibly higher-quality output than `main` baseline.
- [ ] Server logs contain `refinement.complete` JSON entries with `initialIssues`, `finalIssues`, `passes`, token counts.

When green, hand off to Sub-project 2 (Exemplar library + retrieval).
