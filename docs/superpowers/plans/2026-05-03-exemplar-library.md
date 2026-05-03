# Exemplar Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject curated, domain-specific few-shot exemplars into the `generate-tests` and `generate-rubric` prompt builders so the model produces higher-quality output for each domain.

**Architecture:** A single static module (`src/lib/exemplars.ts`) exports a typed exemplar table keyed by `(Domain, Stage)`, plus a deterministic `selectExemplars` function. The two prompt builders (and their critique/revise variants) accept an optional `exemplars` parameter and inline a `## Examples` section when supplied. The two SSE routes select exemplars from the parsed spec's `domain` and pass them to every prompt-builder call.

**Tech Stack:** TypeScript, Vitest, Next.js App Router (Node runtime), Gemini SDK (already mocked in tests).

**Spec alignment note:** The design spec lists 5 exemplar domains (legal/healthcare/code-generation/customer-support/generic). The existing `Domain` type in `src/lib/types.ts` is `'legal' | 'sales' | 'healthcare' | 'general'`. This plan aligns to the existing enum: 4 domains × 2 stages × 3 exemplars = **24 exemplars**. Adding new domains is a separate change that touches `parse-spec` too.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/exemplars.ts` | Create | Exemplar types, EXEMPLARS table, selectExemplars |
| `src/lib/__tests__/exemplars.test.ts` | Create | Unit tests for selectExemplars + content validation |
| `src/lib/prompts.ts` | Modify | Add optional `exemplars` parameter to 6 prompt builders, render `## Examples` section |
| `src/lib/__tests__/prompts.test.ts` | Modify (or create if missing) | Tests for prompt builders with/without exemplars |
| `src/app/api/generate-tests/route.ts` | Modify | Call selectExemplars, pass to all 3 prompt builders |
| `src/app/api/generate-rubric/route.ts` | Modify | Call selectExemplars, pass to all 3 prompt builders |

---

## Task 1: Create exemplars.ts module skeleton with selection logic

**Files:**
- Create: `src/lib/exemplars.ts`
- Create: `src/lib/__tests__/exemplars.test.ts`

- [ ] **Step 1: Write the failing tests for selectExemplars**

Create `src/lib/__tests__/exemplars.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { selectExemplars, EXEMPLARS } from '@/lib/exemplars';
import type { Domain } from '@/lib/types';

describe('selectExemplars', () => {
  it('returns the legal exemplars for the legal domain', () => {
    expect(selectExemplars('legal', 'tests')).toBe(EXEMPLARS.legal.tests);
    expect(selectExemplars('legal', 'rubric')).toBe(EXEMPLARS.legal.rubric);
  });

  it('returns the sales exemplars for the sales domain', () => {
    expect(selectExemplars('sales', 'tests')).toBe(EXEMPLARS.sales.tests);
  });

  it('returns the healthcare exemplars for the healthcare domain', () => {
    expect(selectExemplars('healthcare', 'rubric')).toBe(EXEMPLARS.healthcare.rubric);
  });

  it('returns the general exemplars for the general domain', () => {
    expect(selectExemplars('general', 'tests')).toBe(EXEMPLARS.general.tests);
  });

  it('returns the general exemplars for an unknown domain string', () => {
    expect(selectExemplars('mystery' as Domain, 'tests')).toBe(EXEMPLARS.general.tests);
  });

  it('returns the general exemplars for empty string', () => {
    expect(selectExemplars('' as Domain, 'tests')).toBe(EXEMPLARS.general.tests);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/exemplars.test.ts`
Expected: FAIL with "Cannot find module '@/lib/exemplars'"

- [ ] **Step 3: Implement the module**

Create `src/lib/exemplars.ts`:

```ts
import type { Domain } from '@/lib/types';

export type ExemplarStage = 'tests' | 'rubric';

export type Exemplar = {
  /** A short illustrative spec snippet (~2-4 sentences). */
  spec: string;
  /** The ideal model output as a JSON string. For 'tests' it parses as TestCase[]; for 'rubric' it parses as Rubric. */
  output: string;
  /** 1-2 sentence rationale, inlined into the prompt. */
  rationale: string;
};

export type ExemplarTable = Record<Domain, Record<ExemplarStage, Exemplar[]>>;

// Content is filled in by Task 2. Kept as empty arrays here so the module type-checks.
export const EXEMPLARS: ExemplarTable = {
  legal: { tests: [], rubric: [] },
  sales: { tests: [], rubric: [] },
  healthcare: { tests: [], rubric: [] },
  general: { tests: [], rubric: [] },
};

const KNOWN_DOMAINS = new Set<Domain>(['legal', 'sales', 'healthcare', 'general']);

export function selectExemplars(domain: Domain | string, stage: ExemplarStage): Exemplar[] {
  const d = typeof domain === 'string' && KNOWN_DOMAINS.has(domain as Domain)
    ? (domain as Domain)
    : 'general';
  return EXEMPLARS[d][stage];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/exemplars.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/exemplars.ts src/lib/__tests__/exemplars.test.ts
git commit -m "feat(exemplars): add module skeleton with selectExemplars"
```

---

## Task 2: Author the 24 exemplars (4 domains × 2 stages × 3 each)

**Files:**
- Modify: `src/lib/exemplars.ts` (fill in EXEMPLARS content)
- Modify: `src/lib/__tests__/exemplars.test.ts` (add content-validation tests)

- [ ] **Step 1: Write content-validation tests first**

Append to `src/lib/__tests__/exemplars.test.ts`:

```ts
import type { Rubric, TestCase } from '@/lib/types';

const ALL_DOMAINS = ['legal', 'sales', 'healthcare', 'general'] as const;

describe('EXEMPLARS content', () => {
  it('has exactly 3 exemplars per (domain, stage) cell', () => {
    for (const d of ALL_DOMAINS) {
      expect(EXEMPLARS[d].tests).toHaveLength(3);
      expect(EXEMPLARS[d].rubric).toHaveLength(3);
    }
  });

  it('every exemplar has non-empty spec, output, and rationale', () => {
    for (const d of ALL_DOMAINS) {
      for (const stage of ['tests', 'rubric'] as const) {
        for (const ex of EXEMPLARS[d][stage]) {
          expect(ex.spec.length).toBeGreaterThan(20);
          expect(ex.output.length).toBeGreaterThan(20);
          expect(ex.rationale.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('every tests-stage exemplar.output parses as a non-empty TestCase array', () => {
    for (const d of ALL_DOMAINS) {
      for (const ex of EXEMPLARS[d].tests) {
        const parsed = JSON.parse(ex.output) as TestCase[];
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
        for (const t of parsed) {
          expect(typeof t.id).toBe('string');
          expect(typeof t.input).toBe('string');
          expect(['happy_path', 'edge_case', 'adversarial']).toContain(t.category);
        }
      }
    }
  });

  it('every rubric-stage exemplar.output parses as a Rubric with weights summing to 1.0', () => {
    for (const d of ALL_DOMAINS) {
      for (const ex of EXEMPLARS[d].rubric) {
        const parsed = JSON.parse(ex.output) as Rubric;
        expect(Array.isArray(parsed.dimensions)).toBe(true);
        expect(parsed.dimensions.length).toBeGreaterThanOrEqual(4);
        expect(parsed.dimensions.length).toBeLessThanOrEqual(6);
        const sum = parsed.dimensions.reduce((acc, dim) => acc + dim.weight, 0);
        expect(sum).toBeGreaterThanOrEqual(0.99);
        expect(sum).toBeLessThanOrEqual(1.01);
      }
    }
  });

  it('every exemplar serialized form is under the per-exemplar budget (~700 chars excluding output)', () => {
    // The output JSON can be longer; spec + rationale combined must stay tight.
    for (const d of ALL_DOMAINS) {
      for (const stage of ['tests', 'rubric'] as const) {
        for (const ex of EXEMPLARS[d][stage]) {
          expect(ex.spec.length + ex.rationale.length).toBeLessThan(700);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/exemplars.test.ts`
Expected: FAIL — content tests fail because EXEMPLARS arrays are empty.

- [ ] **Step 3: Author the 24 exemplars**

Replace the empty `EXEMPLARS` constant in `src/lib/exemplars.ts` with hand-written content. The author MUST write each exemplar themselves; the rules below define quality:

**For every `tests`-stage exemplar:**
- `spec` is a 2-4 sentence description of an AI feature in that domain.
- `output` is a JSON string that, when `JSON.parse`d, yields an array of 4-6 `TestCase` objects (NOT 20 — exemplars are illustrative, not full suites).
- The output array must include at least one `happy_path`, one `edge_case`, and one `adversarial` case.
- IDs in the array are zero-padded sequential within the exemplar (`test-01`, `test-02`, …).
- `input` strings are realistic — what a real user would actually paste — not meta-language.
- `rationale` explains in 1-2 sentences what makes this a strong example (e.g. "Demonstrates how to construct a prompt-injection adversarial test specific to legal contract review.").

**For every `rubric`-stage exemplar:**
- `spec` matches the same shape as above.
- `output` is a JSON string that, when `JSON.parse`d, yields `{ dimensions: RubricDimension[] }` with 4-6 dimensions.
- Weights must sum to 1.0 within ±0.01.
- IDs are kebab-case.
- Each dimension's `description` is concrete (scorable), not generic. NEVER use "quality" or "helpfulness" as a dimension label.
- `rationale` explains what makes the rubric domain-specific (e.g. "All 5 dimensions reflect failure modes specific to clinical-note review; nothing generic.").

**Domain coverage (suggested topics — implementer may pick others as long as they're realistic for the domain):**

| Domain | Suggested feature ideas |
|---|---|
| legal | Contract clause extraction; NDA risk flagger; M&A diligence summary |
| sales | Cold-email drafter from LinkedIn profile; CRM note auto-summary; objection-handling response generator |
| healthcare | Clinical-note completeness checker; medication-interaction flagger; CPT/ICD-10 coding assistant |
| general | Customer-support email triage; meeting-transcript action-item extractor; product-review sentiment analyzer |

Each domain × stage cell needs 3 distinct exemplars covering different angles within that domain.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/exemplars.test.ts`
Expected: PASS (all content-validation tests including JSON parsing, weight sums, length budget)

- [ ] **Step 5: Commit**

```bash
git add src/lib/exemplars.ts src/lib/__tests__/exemplars.test.ts
git commit -m "feat(exemplars): author 24 curated few-shot exemplars"
```

---

## Task 3: Update test-stage prompt builders to accept exemplars

**Files:**
- Modify: `src/lib/prompts.ts` (3 functions: buildGenerateTestsPrompt, buildGenerateTestsCritiquePrompt, buildGenerateTestsRevisePrompt)
- Modify or create: `src/lib/__tests__/prompts.test.ts`

- [ ] **Step 1: Write failing tests**

If `src/lib/__tests__/prompts.test.ts` exists, append to it. Otherwise create it. Test cases:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildGenerateTestsPrompt,
  buildGenerateTestsCritiquePrompt,
  buildGenerateTestsRevisePrompt,
} from '@/lib/prompts';
import type { ParsedSpec, TestCase } from '@/lib/types';
import type { Exemplar } from '@/lib/exemplars';

const PARSED: ParsedSpec = {
  feature: 'Test feature',
  inputs: ['x'],
  outputs: ['y'],
  constraints: ['z'],
  domain: 'general',
};

const SAMPLE_EXEMPLAR: Exemplar = {
  spec: 'Sample spec for testing',
  output: '[{"id":"test-01","category":"happy_path","input":"hi"}]',
  rationale: 'Sample rationale',
};

describe('buildGenerateTestsPrompt with exemplars', () => {
  it('omits the Examples section when no exemplars are passed', () => {
    const prompt = buildGenerateTestsPrompt(PARSED);
    expect(prompt).not.toContain('## Examples');
  });

  it('omits the Examples section when an empty exemplars array is passed', () => {
    const prompt = buildGenerateTestsPrompt(PARSED, []);
    expect(prompt).not.toContain('## Examples');
  });

  it('includes each exemplar spec, rationale, and output when exemplars are passed', () => {
    const prompt = buildGenerateTestsPrompt(PARSED, [SAMPLE_EXEMPLAR]);
    expect(prompt).toContain('## Examples');
    expect(prompt).toContain(SAMPLE_EXEMPLAR.spec);
    expect(prompt).toContain(SAMPLE_EXEMPLAR.rationale);
    expect(prompt).toContain(SAMPLE_EXEMPLAR.output);
  });
});

describe('buildGenerateTestsCritiquePrompt with exemplars', () => {
  const tests: TestCase[] = [{ id: 'test-01', category: 'happy_path', input: 'a' }];

  it('omits the Examples section when no exemplars are passed', () => {
    expect(buildGenerateTestsCritiquePrompt(PARSED, tests)).not.toContain('## Examples');
  });

  it('includes the Examples section when exemplars are passed', () => {
    const prompt = buildGenerateTestsCritiquePrompt(PARSED, tests, [SAMPLE_EXEMPLAR]);
    expect(prompt).toContain('## Examples');
    expect(prompt).toContain(SAMPLE_EXEMPLAR.spec);
  });
});

describe('buildGenerateTestsRevisePrompt with exemplars', () => {
  const tests: TestCase[] = [{ id: 'test-01', category: 'happy_path', input: 'a' }];

  it('omits the Examples section when no exemplars are passed', () => {
    expect(buildGenerateTestsRevisePrompt(tests, [])).not.toContain('## Examples');
  });

  it('includes the Examples section when exemplars are passed', () => {
    const prompt = buildGenerateTestsRevisePrompt(tests, [], [SAMPLE_EXEMPLAR]);
    expect(prompt).toContain('## Examples');
    expect(prompt).toContain(SAMPLE_EXEMPLAR.spec);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/prompts.test.ts`
Expected: FAIL — TypeScript compile errors (extra parameter not accepted) or assertion failures.

- [ ] **Step 3: Add a shared renderer + update the 3 functions**

In `src/lib/prompts.ts`, add an import at the top:

```ts
import type { Exemplar } from '@/lib/exemplars';
```

Add this private helper somewhere above the prompt builders (e.g. just below the existing `renderIssues` function):

```ts
function renderExemplars(exemplars: Exemplar[] | undefined, domain: string): string {
  if (!exemplars || exemplars.length === 0) return '';
  const blocks = exemplars
    .map(
      (ex, i) =>
        `### Example ${i + 1}\nSpec: ${ex.spec}\nWhy this is good: ${ex.rationale}\nOutput:\n${ex.output}`,
    )
    .join('\n\n');
  return `\n## Examples\n\nThe following are well-formed examples for similar specs in the ${domain} domain. Match this level of detail and structure.\n\n${blocks}\n\n`;
}
```

Update the three test-stage builders to accept and inline exemplars. For each, add `exemplars?: Exemplar[]` as the last parameter and insert `${renderExemplars(exemplars, parsed.domain)}` (or for revise, hard-code the domain string, see below) at the appropriate spot in the template.

`buildGenerateTestsPrompt(parsed, exemplars?)` — insert renderExemplars output between the Constraints block and the "Generate exactly 20 tests" line.

`buildGenerateTestsCritiquePrompt(parsed, tests, exemplars?)` — insert between the Constraints block and the `Tests JSON:` line.

`buildGenerateTestsRevisePrompt(current, issues, exemplars?)` — revise prompts don't have a parsed-spec context, so when rendering the Examples section here, omit the domain header line. Update `renderExemplars` to accept an empty/optional domain string and omit the "in the X domain" phrase when it's missing. Insert the rendered block between the issues list and the "Produce a corrected test suite" instructions.

Concrete change: replace `renderExemplars` with this domain-optional version:

```ts
function renderExemplars(exemplars: Exemplar[] | undefined, domain?: string): string {
  if (!exemplars || exemplars.length === 0) return '';
  const blocks = exemplars
    .map(
      (ex, i) =>
        `### Example ${i + 1}\nSpec: ${ex.spec}\nWhy this is good: ${ex.rationale}\nOutput:\n${ex.output}`,
    )
    .join('\n\n');
  const intro = domain
    ? `The following are well-formed examples for similar specs in the ${domain} domain. Match this level of detail and structure.`
    : `The following are well-formed examples. Match this level of detail and structure.`;
  return `\n## Examples\n\n${intro}\n\n${blocks}\n\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/prompts.test.ts`
Expected: PASS for the new test-stage cases; existing tests still pass.

Also run the full suite: `npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts.ts src/lib/__tests__/prompts.test.ts
git commit -m "feat(prompts): inline exemplars into generate-tests prompts"
```

---

## Task 4: Update rubric-stage prompt builders to accept exemplars

**Files:**
- Modify: `src/lib/prompts.ts` (3 functions: buildGenerateRubricPrompt, buildGenerateRubricCritiquePrompt, buildGenerateRubricRevisePrompt)
- Modify: `src/lib/__tests__/prompts.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/__tests__/prompts.test.ts`:

```ts
import {
  buildGenerateRubricPrompt,
  buildGenerateRubricCritiquePrompt,
  buildGenerateRubricRevisePrompt,
} from '@/lib/prompts';
import type { Rubric } from '@/lib/types';

const SAMPLE_RUBRIC_EXEMPLAR: Exemplar = {
  spec: 'Rubric exemplar spec',
  output: '{"dimensions":[{"id":"a","label":"A","description":"d","weight":1}]}',
  rationale: 'Rubric rationale',
};

const RUBRIC: Rubric = {
  dimensions: [
    { id: 'a', label: 'A', description: 'd', weight: 1 },
  ],
};

describe('buildGenerateRubricPrompt with exemplars', () => {
  it('omits the Examples section when no exemplars are passed', () => {
    expect(buildGenerateRubricPrompt(PARSED)).not.toContain('## Examples');
  });

  it('includes the Examples section when exemplars are passed', () => {
    const prompt = buildGenerateRubricPrompt(PARSED, [SAMPLE_RUBRIC_EXEMPLAR]);
    expect(prompt).toContain('## Examples');
    expect(prompt).toContain(SAMPLE_RUBRIC_EXEMPLAR.spec);
    expect(prompt).toContain(SAMPLE_RUBRIC_EXEMPLAR.rationale);
    expect(prompt).toContain(SAMPLE_RUBRIC_EXEMPLAR.output);
  });
});

describe('buildGenerateRubricCritiquePrompt with exemplars', () => {
  it('omits the Examples section when no exemplars are passed', () => {
    expect(buildGenerateRubricCritiquePrompt(PARSED, RUBRIC)).not.toContain('## Examples');
  });

  it('includes the Examples section when exemplars are passed', () => {
    const prompt = buildGenerateRubricCritiquePrompt(PARSED, RUBRIC, [SAMPLE_RUBRIC_EXEMPLAR]);
    expect(prompt).toContain('## Examples');
    expect(prompt).toContain(SAMPLE_RUBRIC_EXEMPLAR.spec);
  });
});

describe('buildGenerateRubricRevisePrompt with exemplars', () => {
  it('omits the Examples section when no exemplars are passed', () => {
    expect(buildGenerateRubricRevisePrompt(RUBRIC, [])).not.toContain('## Examples');
  });

  it('includes the Examples section when exemplars are passed', () => {
    const prompt = buildGenerateRubricRevisePrompt(RUBRIC, [], [SAMPLE_RUBRIC_EXEMPLAR]);
    expect(prompt).toContain('## Examples');
    expect(prompt).toContain(SAMPLE_RUBRIC_EXEMPLAR.spec);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/prompts.test.ts`
Expected: FAIL — type errors (extra parameter not accepted) and assertion failures on the new tests.

- [ ] **Step 3: Update the three rubric-stage prompt builders**

In `src/lib/prompts.ts`:

`buildGenerateRubricPrompt(parsed, exemplars?)` — insert `${renderExemplars(exemplars, parsed.domain)}` between the Constraints block and the "Pick 4-6 scoring dimensions" line.

`buildGenerateRubricCritiquePrompt(parsed, rubric, exemplars?)` — insert between the Constraints block and the `Rubric JSON:` line.

`buildGenerateRubricRevisePrompt(current, issues, exemplars?)` — insert between the issues list and the "Produce a corrected rubric" instructions. Pass no domain (uses the generic intro).

The signatures change as follows:

```ts
export function buildGenerateRubricPrompt(parsed: ParsedSpec, exemplars?: Exemplar[]): string
export function buildGenerateRubricCritiquePrompt(parsed: ParsedSpec, rubric: Rubric, exemplars?: Exemplar[]): string
export function buildGenerateRubricRevisePrompt(current: Rubric, issues: Issue[], exemplars?: Exemplar[]): string
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/prompts.test.ts`
Expected: PASS for the new rubric-stage cases.

Run full suite: `npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts.ts src/lib/__tests__/prompts.test.ts
git commit -m "feat(prompts): inline exemplars into generate-rubric prompts"
```

---

## Task 5: Wire exemplars into /api/generate-tests route

**Files:**
- Modify: `src/app/api/generate-tests/route.ts`

- [ ] **Step 1: Add the import and select exemplars once at the top of the route handler**

Add to the imports block at the top of `src/app/api/generate-tests/route.ts`:

```ts
import { selectExemplars } from '@/lib/exemplars';
```

Inside `POST`, after the `parsed` validation passes and before the `ReadableStream` is constructed, add:

```ts
const exemplars = selectExemplars(parsed.domain, 'tests');
```

- [ ] **Step 2: Pass exemplars to all three prompt builders**

Update the three prompt-builder calls inside the `runRefinement` config block:

```ts
generate: async () => {
  const result = await generateJSON<TestCase[] | { tests: TestCase[] }>(
    buildGenerateTestsPrompt(parsed, exemplars),
  );
  return Array.isArray(result) ? result : result.tests;
},
critique: async (current) => {
  const result = await generateJSON<{ issues: Issue[] }>(
    buildGenerateTestsCritiquePrompt(parsed, current, exemplars),
  );
  return Array.isArray(result?.issues) ? result.issues : [];
},
revise: async (current, issues) => {
  const result = await generateJSON<TestCase[] | { tests: TestCase[] }>(
    buildGenerateTestsRevisePrompt(current, issues, exemplars),
  );
  return Array.isArray(result) ? result : result.tests;
},
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: all green. (No new test added — route handler is integration code; the prompt-builder tests already cover the new arg.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/generate-tests/route.ts
git commit -m "feat(api): pass exemplars to generate-tests prompts"
```

---

## Task 6: Wire exemplars into /api/generate-rubric route

**Files:**
- Modify: `src/app/api/generate-rubric/route.ts`

- [ ] **Step 1: Add the import**

Add to the imports block at the top of `src/app/api/generate-rubric/route.ts`:

```ts
import { selectExemplars } from '@/lib/exemplars';
```

- [ ] **Step 2: Select exemplars and pass to all three prompt builders**

Inside `POST`, after the `parsed` validation passes and before the `ReadableStream` is constructed, add:

```ts
const exemplars = selectExemplars(parsed.domain, 'rubric');
```

Then update the three prompt-builder calls in the `runRefinement` config to pass `exemplars` as the final argument to `buildGenerateRubricPrompt`, `buildGenerateRubricCritiquePrompt`, and `buildGenerateRubricRevisePrompt` — exactly the pattern from Task 5.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/generate-rubric/route.ts
git commit -m "feat(api): pass exemplars to generate-rubric prompts"
```

---

## Task 7: Manual smoke test on Vercel preview

**Files:** none — verification only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <current-branch>
```

- [ ] **Step 2: Deploy a preview to Vercel**

```bash
vercel deploy
```

Capture the preview URL.

- [ ] **Step 3: Run the legal contract spec from Round 0 v2**

Open the preview URL. Paste the v2 legal spec (the one from `docs/superpowers/specs/2026-05-03-exemplar-library-design.md` § Success criteria reference).

Wait for parse → tests → rubric → run-eval to complete.

- [ ] **Step 4: Compare scores**

Open the previous run's bundle (`evalforge-bundle.json` from Round 0 v2) and compare:

- Overall pass rate: previous = 17/20 (0.78). Expected: ≥17/20, with overall ≥0.78.
- Redline / Risk-Identification dimensions (or whatever the rubric named them): expected to lift by ≥5 percentage points each.

If both pass, proceed to Step 5. If either regresses, file a follow-up issue noting which exemplars likely need revision.

- [ ] **Step 5: Merge to main**

```bash
git checkout dev
git merge <branch-name> --no-ff
git push origin dev
git checkout main
git merge dev --ff-only
git push origin main
vercel deploy --prod
```

---

## Self-Review

**Spec coverage:**
- Module `src/lib/exemplars.ts` with EXEMPLARS table + selectExemplars → Task 1
- Selection logic (case-insensitive, fallback to general) → Task 1 (plan deviates from spec by using exact-match on the Domain enum since it's typed; documented at top)
- 24 hand-written exemplars → Task 2
- Content validation (JSON parsing, weight sums, length budget) → Task 2
- Prompt builders accept exemplars → Tasks 3 & 4
- Routes wire exemplars through → Tasks 5 & 6
- Manual smoke + success-criteria check → Task 7
- Backwards compatibility (exemplars param is optional) → enforced by Tasks 3 & 4 tests
- Token budget (700 chars × 3 per exemplar excluding output) → Task 2 test

**Spec deviations:**
- 4 domains, not 5 (no `customer-support`, no `code-generation`). The spec's `code-generation` and `customer-support` domains aren't in the existing `Domain` enum; adding them would require parse-spec prompt changes outside this plan's scope.
- Selection function takes `Domain | string` (not free-form string with alias matching). Simpler given the typed enum.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "fill in details" / "similar to Task N" / "etc." in any task. Step 3 of Task 2 explicitly delegates content authorship to the implementer with a quality bar — that is a content-authorship instruction, not a placeholder.

**Type consistency:** `Exemplar`, `ExemplarStage`, `ExemplarTable`, `EXEMPLARS`, `selectExemplars(domain, stage)` are used identically across all tasks. The `renderExemplars(exemplars, domain?)` helper signature is consistent. Domain values match the existing `Domain` type.
