# EvalForge Plan C — Eval Runner + Scorecard Design Spec

**Date:** 2026-05-03
**Sub-project:** Plan C (Phases 7–9 of the umbrella design)
**Depends on:** Plan A ✅, Plan B ✅, Sub-project 1 (Refinement Loops) ✅

## Goal

Add a 4th stage to EvalForge's pipeline that runs the 20 generated tests through Gemini, scores each against the rubric, and presents an interactive scorecard with export. After the rubric stage completes, the user clicks **Run 20 evals**, and within ~90–120 seconds gets a streaming progress view followed by a scorecard with overall score, per-test pass/fail (against an adjustable threshold), per-dimension breakdown, and downloadable results.

## Architecture

A new `/api/run-eval` route streams snapshot SSE events while running 20 tests concurrently (pool of 2) through a single-call judge prompt that produces both the feature output and self-scores in one JSON response. The page state machine gains a 4th stage (`run`) that the user explicitly triggers via a button rendered after `rubric.phase === 'done'`. Results are held in client memory only — no persistence, refresh = fresh run.

The Scorecard component renders headline metrics from the final `done` payload and recomputes per-test pass/fail in real time as the user drags a threshold slider, without re-running anything.

## Locked Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Concurrency = 2 via new `runBatched(items, fn, { concurrency: 2, gapMs: 15000 })` helper. `gapMs` enforces a min interval between request *starts* within a worker. | Halves wall time vs sequential while staying inside Gemini Flash RPM. |
| 2 | Single-call judge: one prompt produces output + self-scores per dimension in one JSON response. | Halves API cost/latency. Accepted leniency-bias risk for v1. |
| 3 | SSE event schema: snapshot events. Frame 1: `started { total: 20 }`. Then every ~2s: `progress { completed, total, partialResults }`. Final frame on success: `done { results, summary }`. On failure: `error { message }`. | Simpler client (replace state vs reconcile). One reducer action. |
| 4 | Trigger: explicit `<EvalRunButton>` rendered after `rubric.phase === 'done'`. | Lets user inspect the rubric before committing API budget. |
| 5 | Scorecard contents: weighted overall (headline) + "N of 20 passed" + per-dimension bars showing avg score per dimension. | All three metrics compose; cost is one render. |
| 6 | Pass threshold: slider in the Scorecard, default 0.7, range 0.5–1.0, step 0.05. Pass/fail recomputes via `useMemo`; no re-run. | Lets user explore strictness without re-spending API budget. |
| 7 | Export: 3 buttons — full bundle JSON (spec + parsed + tests + rubric + results + summary), results-only JSON, CSV (one row per test). | Bundle for reproducibility, results-only for piping into other tools, CSV for spreadsheets. |
| 8 | Polish included in Plan C: 5000-char input cap on the spec textarea (with counter), responsive Scorecard table (sm: breakpoints), Next.js `metadata` export for title/description/OG tags. | Closes out remaining Phase 9 items. |

## Components & Files

```
src/
├── app/
│   ├── api/run-eval/
│   │   ├── route.ts                          # SSE producer
│   │   └── __tests__/route.test.ts
│   ├── layout.tsx                            # +metadata export
│   └── page.tsx                              # +run stage state, +EvalRunButton, +Scorecard, +ExportButtons
├── lib/
│   ├── runBatched.ts                         # Concurrency pool with gapMs
│   ├── runBatched.test.ts                    # Fake-timer tests
│   ├── prompts.ts                            # +buildRunEvalPrompt
│   ├── pageReducer.ts                        # +run stage in state
│   ├── scoring.ts                            # weightedOverall, summarize
│   ├── scoring.test.ts
│   ├── export.ts                             # toBundleJSON, toResultsJSON, toCSV
│   └── export.test.ts
└── components/
    ├── EvalRunButton.tsx                     # disabled state + click handler
    ├── EvalProgress.tsx                      # progress bar, "12/20 done"
    ├── ResultsTable.tsx                      # row per test, expandable
    ├── Scorecard.tsx                         # headline + slider + per-dim bars
    ├── ExportButtons.tsx                     # 3 buttons, blob downloads
    └── SpecForm.tsx                          # +5000 char cap + counter (modify)
```

### File responsibilities

- **`runBatched.ts`** — pure function. Takes `items: T[]`, `fn: (item: T, signal?: AbortSignal) => Promise<U>`, options `{ concurrency, gapMs, signal?, onProgress?: (completed: number, partial: U[]) => void }`. Returns `Promise<U[]>`. Per-item errors are returned as-is in the array (caller decides how to surface); whole batch only rejects on AbortSignal.
- **`scoring.ts`** — `weightedOverall(scores: EvalScore[], rubric: Rubric): number`, `summarize(results: EvalResult[], rubric: Rubric, threshold: number): Summary` returning `{ overall, passedCount, perDimension: Record<string, number> }`.
- **`export.ts`** — three pure builders that take the relevant slice of state and return string. Browser-side trigger is a 5-line helper in `ExportButtons.tsx`.
- **`buildRunEvalPrompt(parsed, rubric, test)`** — produces a prompt instructing Gemini to: (a) produce the feature output for `test.input`, (b) score that output on each rubric dimension with a short reasoning, all in one JSON object matching `{ output: string, scores: [{ dimensionId, score, reasoning }] }`.
- **`/api/run-eval/route.ts`** — `runtime = 'nodejs'`, `maxDuration = 300`. Validates body `{ parsed: ParsedSpec, rubric: Rubric, tests: TestCase[] }`. Opens SSE stream. Starts `setInterval` ticker. Calls `runBatched(tests, judgeOne, { concurrency: 2, gapMs: 15000, onProgress })` which mutates a `partialResults` array as items resolve. Ticker emits `progress` with current snapshot. On batch resolve: clear ticker, emit `done`, close. On error: clear ticker, emit `error`, close. AbortSignal from `request.signal` cancels the batch.

## Data Flow

```
User clicks "Run 20 evals"
   ↓
page.tsx dispatches STAGE_START stage='run'
   ↓
fetch('/api/run-eval', { parsed, rubric, tests }) opens SSE
   ↓
Route validates, opens stream, emits started { total: 20 }
   ↓
Route starts batch (2 workers, gapMs=15000) + ticker (2s)
   ↓
Each judgeOne call: one Gemini call, parse JSON, append to partialResults
   ↓
Every 2s: ticker emits progress { completed, total, partialResults }
   ↓
Page reducer replaces stage.current with the latest snapshot
   ↓
EvalProgress shows "12/20 done"; ResultsTable shows partial rows
   ↓
Batch resolves → ticker cleared → emit done { results, summary } → close
   ↓
Page reducer marks stage done; Scorecard + ExportButtons render
```

### State machine additions

`pageReducer.ts` gains:
```ts
stages: {
  parse: StageState<ParsedSpec>;
  tests: StageState<TestCase[]>;
  rubric: StageState<Rubric>;
  run: StageState<RunSnapshot>;          // NEW
}
```

`RunSnapshot` is the union of intermediate (`{ completed, total, partialResults }`) and final (`{ results, summary }`) shapes. The reducer treats them uniformly via the existing `current: T | null` slot.

## Single-Call Judge Prompt — Skeleton

```
You are an evaluation engineer. The feature spec below describes an AI feature.
Produce the feature output for the given input, then score that output on each
rubric dimension.

Feature: {parsed.feature}
Domain: {parsed.domain}
Inputs the feature expects: ...
Outputs the feature produces: ...
Constraints the output must satisfy: ...

Rubric dimensions:
- {dim.id}: {dim.label} — {dim.description}
- ...

Test input:
"""
{test.input}
"""

Respond with ONLY this JSON (no prose, no markdown):
{
  "output": "the feature output for the test input",
  "scores": [
    { "dimensionId": "...", "score": 0.0, "reasoning": "1-line justification" },
    ...
  ]
}

Rules:
- Score each dimension on a 0.0–1.0 scale where 1.0 means fully satisfied.
- Be honest. Penalize the output for failing constraints, even if the answer is otherwise good.
- Reasoning is one short sentence. No hedging.
- Output JSON only.
```

**Risk:** self-scoring is famously unreliable; expect mean scores in the 0.7–0.9 range regardless of true quality. Mitigations: explicit "be honest, penalize" instruction; require per-score reasoning (forces the model to articulate, which empirically reduces inflation); inspect actual scores manually across 3 example specs; if the prompt produces flat/uniform scores, escalate to a separate-judge call (Plan C+1).

## Testing

- **`runBatched.test.ts`** (vitest fake timers) — concurrency cap respected, `gapMs` enforced between starts within a worker, AbortSignal cancels in-flight, per-item errors don't kill the batch, `onProgress` called after every resolve.
- **`scoring.test.ts`** — weighted overall matches hand calculation, threshold edge cases (=0.7 passes), per-dim averages.
- **`export.test.ts`** — JSON shapes match snapshots, CSV escapes quotes/newlines in `reasoning`, headers correct.
- **`prompts.test.ts`** — `buildRunEvalPrompt` includes all rubric dimension ids, the test input, and explicit JSON-only instruction.
- **`route.test.ts`** — mocks `lib/gemini`, asserts SSE event sequence (`started → progress* → done`), asserts AbortSignal propagation, asserts error-event-on-throw.
- **`Scorecard.test.tsx`** — slider drag re-tags pass/fail, no API call fires, per-dim bars reflect summary.
- **`ResultsTable.test.tsx`** — row expand/collapse, partial render during ticking.
- **Manual smoke** (gates the plan): each example chip → click Run 20 evals → see progress ticking → final scorecard with sane scores → export each format → verify file contents.

## Risks & Open Items

1. **Single-call judge quality.** Highest-risk piece. De-risk via the recommended first task (see "Implementation Order" below). If the prompt doesn't produce reliable scores after 2–3 iterations, escalate scope to a two-call judge.
2. **Gemini RPD with refinement loops + 20 evals.** Refinement loops cost up to ~9 calls (3 stages × 3 calls). Run-eval adds 20. Total ~29 calls per full session. Flash free tier is 1500 RPD — fine for demos, tight for repeated dev iteration. Consider stubbing the runner during dev with a `MOCK_GEMINI=1` env flag.
3. **Snapshot ticker race conditions.** Ticker firing after stream close, double `done`, leaked timer on AbortSignal. Tests must cover: client disconnect mid-batch, error-on-first-test, error-on-last-test.
4. **Slider drag performance.** Recomputing pass/fail on every slider tick can stutter with 20 results. `useMemo` keyed on threshold + results identity is sufficient; no debounce needed at this size.
5. **CSV escaping.** Reasoning strings can contain quotes, commas, newlines, unicode. Standard RFC 4180 escaping (double-quote wrap, embedded `"` becomes `""`).

## Implementation Order (recommended)

The recommended first task de-risks #1 cheaply:

**Task 0 (de-risk):** Write `buildRunEvalPrompt` + a 30-line ad-hoc script (not committed) that runs ONE test from the legal example through it and prints the resulting JSON. Eyeball: are the scores sane? Does the JSON parse? Iterate the prompt 1–3 times. Only commit `buildRunEvalPrompt` once the output is trustworthy. **If this fails after 3 attempts, escalate scope to a two-call judge before continuing.**

Then in implementation-plan order:
1. `runBatched` + tests (pure logic, no Gemini)
2. `scoring` + tests (pure logic)
3. `export` + tests (pure logic)
4. `buildRunEvalPrompt` + tests (already de-risked in Task 0)
5. `/api/run-eval` route + tests (mocked Gemini)
6. `pageReducer` extension + tests
7. `EvalRunButton`, `EvalProgress`, `ResultsTable`, `Scorecard`, `ExportButtons` + tests
8. `page.tsx` wiring (button after rubric, run stage, render Scorecard + Export)
9. Polish (5000-char cap + counter, mobile responsive, metadata)
10. Manual smoke across 3 chips — gate

## Out of Scope

- Two-call judge (separate output and judge calls) — Plan C+1 if single-call quality is too low.
- Persistence of runs (localStorage / DB) — never per umbrella spec.
- Re-running a single failed test — Plan D.
- Diffing two rubric versions or comparing two runs — Plan D.
- Auth, multi-user, sharing, history — never per umbrella spec.
