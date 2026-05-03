# Exemplar Library — Design Spec

**Date:** 2026-05-03
**Status:** Draft for review
**Owner:** EvalForge

## Goal

Improve the quality of generated test suites and rubrics by injecting curated, domain-specific few-shot exemplars into the `generate-tests` and `generate-rubric` prompts. The model sees concrete examples of what a good test case or rubric looks like for the detected domain and produces output closer to that pattern.

This directly addresses the two weakest dimensions observed in recent eval runs:

- Redline / specificity quality on rubric dimensions (model produces vague descriptors)
- Test case coverage breadth (model under-generates edge and adversarial cases)

## Non-goals

- User-uploaded or user-edited exemplars
- Exemplars for `parse-spec` or `run-eval`
- Per-customer / multi-tenant exemplar storage
- Embedding-based or quality-ranked exemplar retrieval
- A UI panel for browsing exemplars

## Architecture

A single static module exports a typed exemplar table and a selection function. Prompt builders accept an exemplar list and inline it as a `## Examples` section.

```
src/lib/
  exemplars.ts        ← new
  prompts.ts          ← modified: buildGenerateTestsPrompt, buildGenerateRubricPrompt accept exemplars
  refinement.ts       ← unchanged
src/app/api/
  generate-tests/route.ts   ← modified: select exemplars, pass to prompt builder
  generate-rubric/route.ts  ← modified: same
```

## Module: `src/lib/exemplars.ts`

```ts
export type ExemplarStage = 'tests' | 'rubric';

export type ExemplarDomain =
  | 'legal'
  | 'healthcare'
  | 'code-generation'
  | 'customer-support'
  | 'generic';

export type Exemplar = {
  /** A short illustrative spec snippet, ~2-4 sentences. */
  spec: string;
  /** The ideal model output as a JSON string (TestCase[] for 'tests', Rubric for 'rubric'). */
  output: string;
  /** 1-2 sentence rationale. Inlined into the prompt so the model knows WHY this is good. */
  rationale: string;
};

export const EXEMPLARS: Record<ExemplarDomain, Record<ExemplarStage, Exemplar[]>>;

/** Case-insensitive contains-match against the parsed.domain string. Falls back to 'generic'. */
export function selectExemplars(domain: string, stage: ExemplarStage): Exemplar[];
```

### Selection logic

`selectExemplars(domain, stage)`:

1. Normalize input: `domain.toLowerCase()`.
2. For each known `ExemplarDomain` (excluding `'generic'`), if `normalized.includes(d)` (or any of its aliases), return that domain's exemplars for the stage.
3. Otherwise return `EXEMPLARS.generic[stage]`.

Aliases (initial set):
- `legal`: `legal`, `contract`, `compliance`, `law`
- `healthcare`: `healthcare`, `medical`, `clinical`, `patient`, `physician`
- `code-generation`: `code`, `codegen`, `programming`, `developer`, `pull request`, `pr review`
- `customer-support`: `support`, `customer service`, `helpdesk`, `ticket`

If multiple aliases match, pick the first in the order above. (Deterministic; no scoring.)

### Content

Three exemplars per (domain × stage) cell. 5 domains × 2 stages × 3 exemplars = 30 exemplars total, hand-written.

Each exemplar's `output` JSON must:
- Conform exactly to the `TestCase[]` or `Rubric` TypeScript type
- Be valid JSON (verified by a unit test that `JSON.parse`s every exemplar's output)
- Be representative — contain at least one happy-path, one edge, and one adversarial case (for `tests`); contain 4-5 dimensions with weights summing to 1.0 (for `rubric`)

## Prompt integration

`buildGenerateTestsPrompt(parsed, exemplars?)` and `buildGenerateRubricPrompt(parsed, exemplars?)` change signatures to accept an optional `exemplars: Exemplar[]` parameter.

When `exemplars` is non-empty, the prompt gets a new section before the existing instructions:

```
## Examples

The following are well-formed examples for similar specs in the {domain} domain. Match this level of detail and structure.

### Example 1
Spec: {exemplar.spec}
Why this is good: {exemplar.rationale}
Output:
{exemplar.output}

### Example 2
... (same shape)
```

Critique and revise prompts (in `prompts.ts`) get the same exemplars block — so the refinement loop's `revise` step stays on-pattern.

## Route changes

In `src/app/api/generate-tests/route.ts` and `src/app/api/generate-rubric/route.ts`, after the parsed spec is available:

```ts
import { selectExemplars } from '@/lib/exemplars';
const exemplars = selectExemplars(parsed.domain, 'tests'); // or 'rubric'
```

Pass `exemplars` to every prompt builder call (generate, critique, revise).

## Token budget

Cap each stage's exemplar block at ~2k tokens of content. Hand-written exemplars must respect this; a unit test asserts each exemplar's serialized form is under 700 chars × 3 ≈ 2.1k.

If we ever exceed the budget, pick the first 2 exemplars instead of all 3 (simple deterministic truncation, no token counting at runtime).

## Testing

### Unit tests

- `selectExemplars`:
  - Exact domain name match returns that domain's list.
  - Alias contains-match works (`'medical billing'` → healthcare).
  - Multiple aliases match → deterministic priority order.
  - Unknown domain → returns `'generic'`.
  - Empty / null / non-string domain → returns `'generic'` (defensive).
- `EXEMPLARS` content:
  - Every exemplar's `output` is valid JSON.
  - Every `tests` exemplar parses as a non-empty array of objects with `id` and `input` fields.
  - Every `rubric` exemplar parses as `{ dimensions: [{ id, label, weight, ... }] }` with weights summing to 1.0 ± 0.01.
  - Every exemplar's serialized length is under the per-exemplar budget.
- Prompt builders:
  - `buildGenerateTestsPrompt(parsed)` (no exemplars) produces no `## Examples` section.
  - `buildGenerateTestsPrompt(parsed, exemplars)` produces a `## Examples` section containing each exemplar's spec / rationale / output.
  - Same for rubric.
  - Snapshot test for one fully-rendered prompt to catch accidental drift.

### No e2e changes

The Gemini SDK is already mocked in tests; route tests just need to verify `selectExemplars` is called with the parsed domain and the right stage label.

## Backwards compatibility

`exemplars` is an optional parameter on prompt builders. Existing callers in tests don't change. Routes are the only callers that pass real exemplars in production.

## Rollout

Single PR, branch off `dev`. Deploy preview → smoke-test (paste the legal spec from Round 0, confirm rubric quality lifts) → merge to `main`.

## Risk register

| Risk | Mitigation |
|---|---|
| Prompt size pushes over Gemini context window on long specs | 2k-token cap per stage; spec body is the dominant size, this adds at most ~5%. |
| Hand-written exemplars become stale as types evolve | Unit tests parse every exemplar against the live TypeScript types — type drift breaks tests immediately. |
| Domain detection misses an obvious case | Aliases are explicit and easy to extend; fallback to `generic` always returns useful content. |
| Exemplars lock the model into a narrow pattern | Each domain ships 3 distinct exemplars covering different angles; rationale text encourages adaptation, not copying. |

## Success criteria

- All unit tests pass.
- Re-running the legal spec (Round 0 v2) shows Redline Generation and Risk Identification dimension scores both lift by ≥5 percentage points.
- No regression in overall pass rate (≥17/20 on the same eval).
- Latency unchanged (exemplar selection is sync, in-process; prompt size growth ≤5%).
