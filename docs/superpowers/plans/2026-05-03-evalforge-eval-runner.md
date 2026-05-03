# EvalForge Plan C — Eval Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th stage that runs the 20 generated tests through Gemini (single-call output+self-score), streams snapshot progress over SSE, and presents an interactive scorecard with adjustable threshold and three export formats.

**Architecture:** New `/api/run-eval` SSE route runs `runBatched(tests, judgeOne, { concurrency: 2, gapMs: 15000 })` while a 2s `setInterval` ticker emits `progress` snapshots. The page state machine gains a `run` stage triggered by an explicit button after `rubric.phase === 'done'`. Scorecard recomputes pass/fail in `useMemo` on slider drag — no re-runs. Results live in client memory only.

**Tech Stack:** Next.js 16.2.4 App Router, Vitest with fake timers for runBatched, React 19 (`useMemo`, `useReducer`), Tailwind 4. Gemini calls mocked in all tests.

**Spec reference:** `docs/superpowers/specs/2026-05-03-evalforge-eval-runner-design.md`

---

## Task 0 (de-risk): Judge prompt smoke test

**Goal:** Prove the single-call judge prompt produces parseable JSON with sane scores BEFORE building the runtime around it. If this fails after 3 prompt iterations, escalate to two-call judge before continuing.

**Files:**
- Create (throwaway, gitignored): `scripts/smoke-judge.ts`

- [ ] **Step 1: Write `scripts/smoke-judge.ts` (do not commit)**

```ts
// Usage: GEMINI_API_KEY=... npx tsx scripts/smoke-judge.ts
import { generateJSON } from '../src/lib/gemini';
import type { ParsedSpec, Rubric, TestCase } from '../src/lib/types';

const parsed: ParsedSpec = {
  feature: 'Summarize a contract clause into one plain-English sentence',
  domain: 'legal',
  inputs: ['a single contract clause as raw text'],
  outputs: ['a one-sentence plain-English summary'],
  constraints: [
    'no legalese',
    'preserves the obligation direction (who owes what to whom)',
    'one sentence, ≤ 25 words',
  ],
};
const rubric: Rubric = {
  dimensions: [
    { id: 'fidelity', label: 'Fidelity', description: 'Preserves the clause meaning.', weight: 0.4 },
    { id: 'plain-language', label: 'Plain language', description: 'No legalese.', weight: 0.3 },
    { id: 'brevity', label: 'Brevity', description: 'One sentence, ≤25 words.', weight: 0.3 },
  ],
};
const test: TestCase = {
  id: 'test-01',
  category: 'happy_path',
  input: 'The Lessee shall, on or before the first day of each calendar month, remit to the Lessor the sum of $2,500 in immediately available funds.',
};

// Inline prompt for iteration; will be moved to lib/prompts.ts as buildRunEvalPrompt
const prompt = `... (paste the prompt being iterated) ...`;
const result = await generateJSON(prompt);
console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 2: Run, eyeball, iterate.**

Run: `GEMINI_API_KEY=... npx tsx scripts/smoke-judge.ts`
Expected: a JSON object `{ output: string, scores: [{ dimensionId, score, reasoning }] }` with 3 scores covering all 3 dimensions, each in [0,1], reasoning is one sentence per score.

Iterate the prompt up to 3 times if scores look uniform/inflated or JSON is malformed. Optional: add `add scripts/` to `.gitignore` to keep the throwaway out of git.

- [ ] **Step 3: Lock the prompt language for Task 4.**

Once trustworthy, copy the working prompt skeleton into a comment at the top of `src/lib/prompts.ts` for the Task 4 implementer to use. **No commit yet.**

---

## Task 1: `runBatched` helper

**Files:**
- Create: `src/lib/runBatched.ts`
- Test: `src/lib/__tests__/runBatched.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/runBatched.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runBatched } from '@/lib/runBatched';

describe('runBatched', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns results in input order', async () => {
    const items = [1, 2, 3, 4, 5];
    const fn = vi.fn(async (n: number) => n * 2);
    const promise = runBatched(items, fn, { concurrency: 2, gapMs: 0 });
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it('respects concurrency cap', async () => {
    const inflight: number[] = [];
    let max = 0;
    const fn = async (n: number) => {
      inflight.push(n);
      max = Math.max(max, inflight.length);
      await new Promise((r) => setTimeout(r, 100));
      inflight.splice(inflight.indexOf(n), 1);
      return n;
    };
    const promise = runBatched([1, 2, 3, 4, 5, 6], fn, { concurrency: 2, gapMs: 0 });
    await vi.runAllTimersAsync();
    await promise;
    expect(max).toBe(2);
  });

  it('enforces gapMs between starts within a worker', async () => {
    const starts: number[] = [];
    const fn = async (n: number) => {
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 10));
      return n;
    };
    vi.setSystemTime(0);
    const promise = runBatched([1, 2, 3, 4], fn, { concurrency: 1, gapMs: 1000 });
    await vi.runAllTimersAsync();
    await promise;
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
  });

  it('per-item errors are returned in the array, not thrown', async () => {
    const fn = async (n: number) => {
      if (n === 2) throw new Error('boom');
      return n;
    };
    const promise = runBatched([1, 2, 3], fn, { concurrency: 1, gapMs: 0 });
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out[0]).toBe(1);
    expect(out[1]).toBeInstanceOf(Error);
    expect(out[2]).toBe(3);
  });

  it('calls onProgress after each resolve with a snapshot', async () => {
    const onProgress = vi.fn();
    const fn = async (n: number) => n;
    const promise = runBatched([1, 2, 3], fn, { concurrency: 1, gapMs: 0, onProgress });
    await vi.runAllTimersAsync();
    await promise;
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls[2][0]).toBe(3); // completed
    expect(onProgress.mock.calls[2][1]).toEqual([1, 2, 3]); // partial
  });

  it('AbortSignal aborts the batch', async () => {
    const ctrl = new AbortController();
    const fn = async (n: number) => {
      await new Promise((r) => setTimeout(r, 100));
      return n;
    };
    const promise = runBatched([1, 2, 3, 4], fn, { concurrency: 1, gapMs: 0, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 50);
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/abort/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/runBatched.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runBatched`**

```ts
// src/lib/runBatched.ts
export type RunBatchedOptions<U> = {
  concurrency: number;
  gapMs: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, partial: (U | Error)[]) => void;
};

export async function runBatched<T, U>(
  items: T[],
  fn: (item: T, signal?: AbortSignal) => Promise<U>,
  opts: RunBatchedOptions<U>,
): Promise<(U | Error)[]> {
  const { concurrency, gapMs, signal, onProgress } = opts;
  const results: (U | Error)[] = new Array(items.length);
  let next = 0;
  let completed = 0;

  if (signal?.aborted) throw new Error('Aborted');

  const worker = async () => {
    let lastStart = -Infinity;
    while (true) {
      if (signal?.aborted) throw new Error('Aborted');
      const i = next++;
      if (i >= items.length) return;

      const wait = Math.max(0, gapMs - (Date.now() - lastStart));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();

      try {
        results[i] = await fn(items[i], signal);
      } catch (err) {
        results[i] = err instanceof Error ? err : new Error(String(err));
      }
      completed++;
      onProgress?.(completed, results.slice(0, completed));
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());

  // Race workers against AbortSignal
  await Promise.race([
    Promise.all(workers),
    new Promise<never>((_, rej) => {
      if (signal) signal.addEventListener('abort', () => rej(new Error('Aborted')));
    }),
  ]);
  return results;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test:run -- src/lib/__tests__/runBatched.test.ts`
Expected: PASS 6/6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runBatched.ts src/lib/__tests__/runBatched.test.ts
git commit -m "feat: add runBatched concurrency helper with gapMs and AbortSignal"
```

---

## Task 2: Scoring helpers

**Files:**
- Create: `src/lib/scoring.ts`
- Test: `src/lib/__tests__/scoring.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { weightedOverall, summarize } from '@/lib/scoring';
import type { Rubric, EvalResult } from '@/lib/types';

const rubric: Rubric = {
  dimensions: [
    { id: 'a', label: 'A', description: '', weight: 0.5 },
    { id: 'b', label: 'B', description: '', weight: 0.3 },
    { id: 'c', label: 'C', description: '', weight: 0.2 },
  ],
};

describe('weightedOverall', () => {
  it('computes weighted sum', () => {
    const overall = weightedOverall(
      [
        { dimensionId: 'a', score: 1, reasoning: '' },
        { dimensionId: 'b', score: 0.5, reasoning: '' },
        { dimensionId: 'c', score: 0, reasoning: '' },
      ],
      rubric,
    );
    expect(overall).toBeCloseTo(0.65, 5);
  });

  it('treats missing dimension as 0', () => {
    const overall = weightedOverall(
      [{ dimensionId: 'a', score: 1, reasoning: '' }],
      rubric,
    );
    expect(overall).toBeCloseTo(0.5, 5);
  });
});

describe('summarize', () => {
  const results: EvalResult[] = [
    { testId: 't1', output: 'x', passed: false, scores: [
      { dimensionId: 'a', score: 1, reasoning: '' },
      { dimensionId: 'b', score: 1, reasoning: '' },
      { dimensionId: 'c', score: 1, reasoning: '' },
    ]},
    { testId: 't2', output: 'x', passed: false, scores: [
      { dimensionId: 'a', score: 0, reasoning: '' },
      { dimensionId: 'b', score: 0, reasoning: '' },
      { dimensionId: 'c', score: 0, reasoning: '' },
    ]},
  ];

  it('overall is mean of per-test weighted overalls', () => {
    const s = summarize(results, rubric, 0.7);
    expect(s.overall).toBeCloseTo(0.5, 5);
  });

  it('passedCount uses threshold (inclusive)', () => {
    const s = summarize(results, rubric, 1.0);
    expect(s.passedCount).toBe(1);
  });

  it('perDimension is mean per dimension', () => {
    const s = summarize(results, rubric, 0.7);
    expect(s.perDimension.a).toBeCloseTo(0.5, 5);
    expect(s.perDimension.b).toBeCloseTo(0.5, 5);
    expect(s.perDimension.c).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** `npm run test:run -- src/lib/__tests__/scoring.test.ts`

- [ ] **Step 3: Implement scoring**

```ts
// src/lib/scoring.ts
import type { EvalResult, EvalScore, Rubric } from '@/lib/types';

export function weightedOverall(scores: EvalScore[], rubric: Rubric): number {
  const byId = new Map(scores.map((s) => [s.dimensionId, s.score]));
  let total = 0;
  for (const dim of rubric.dimensions) {
    total += (byId.get(dim.id) ?? 0) * dim.weight;
  }
  return total;
}

export type Summary = {
  overall: number;
  passedCount: number;
  perDimension: Record<string, number>;
};

export function summarize(
  results: EvalResult[],
  rubric: Rubric,
  threshold: number,
): Summary {
  const overalls = results.map((r) => weightedOverall(r.scores, rubric));
  const overall = overalls.reduce((a, b) => a + b, 0) / Math.max(1, overalls.length);
  const passedCount = overalls.filter((o) => o >= threshold).length;
  const perDimension: Record<string, number> = {};
  for (const dim of rubric.dimensions) {
    const sum = results.reduce((acc, r) => {
      const score = r.scores.find((s) => s.dimensionId === dim.id)?.score ?? 0;
      return acc + score;
    }, 0);
    perDimension[dim.id] = sum / Math.max(1, results.length);
  }
  return { overall, passedCount, perDimension };
}
```

- [ ] **Step 4: Run to verify PASS.** Expect 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring.ts src/lib/__tests__/scoring.test.ts
git commit -m "feat: add scoring helpers (weightedOverall, summarize)"
```

---

## Task 3: Export helpers (JSON + CSV)

**Files:**
- Create: `src/lib/export.ts`
- Test: `src/lib/__tests__/export.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/export.test.ts
import { describe, it, expect } from 'vitest';
import { toBundleJSON, toResultsJSON, toCSV } from '@/lib/export';
import type { ParsedSpec, Rubric, TestCase, EvalResult } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

const spec = 'do the thing';
const parsed: ParsedSpec = { feature: 'f', domain: 'general', inputs: [], outputs: [], constraints: [] };
const rubric: Rubric = { dimensions: [
  { id: 'a', label: 'A', description: '', weight: 0.5 },
  { id: 'b', label: 'B', description: '', weight: 0.5 },
]};
const tests: TestCase[] = [{ id: 't1', category: 'happy_path', input: 'in' }];
const results: EvalResult[] = [
  { testId: 't1', output: 'o', passed: true, scores: [
    { dimensionId: 'a', score: 0.8, reasoning: 'good' },
    { dimensionId: 'b', score: 0.6, reasoning: 'has "quote", and\nnewline' },
  ]},
];
const summary: Summary = { overall: 0.7, passedCount: 1, perDimension: { a: 0.8, b: 0.6 } };

it('toBundleJSON includes spec, parsed, tests, rubric, results, summary', () => {
  const obj = JSON.parse(toBundleJSON({ spec, parsed, tests, rubric, results, summary }));
  expect(obj.spec).toBe(spec);
  expect(obj.parsed).toEqual(parsed);
  expect(obj.tests).toEqual(tests);
  expect(obj.rubric).toEqual(rubric);
  expect(obj.results).toEqual(results);
  expect(obj.summary).toEqual(summary);
});

it('toResultsJSON returns just results array', () => {
  const arr = JSON.parse(toResultsJSON(results));
  expect(arr).toEqual(results);
});

it('toCSV escapes quotes (RFC 4180) and newlines', () => {
  const csv = toCSV(results, rubric);
  const lines = csv.split('\r\n');
  expect(lines[0]).toBe('testId,output,passed,a_score,a_reasoning,b_score,b_reasoning');
  // Row contains a quoted field with embedded newline + escaped quote
  expect(csv).toContain('"has ""quote"", and\nnewline"');
});

it('toCSV one row per result', () => {
  const csv = toCSV(results, rubric);
  // header + 1 row, possibly trailing CRLF
  expect(csv.trim().split('\r\n').length).toBe(2);
});
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement export**

```ts
// src/lib/export.ts
import type { ParsedSpec, Rubric, TestCase, EvalResult } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

export type Bundle = {
  spec: string;
  parsed: ParsedSpec;
  tests: TestCase[];
  rubric: Rubric;
  results: EvalResult[];
  summary: Summary;
};

export function toBundleJSON(b: Bundle): string {
  return JSON.stringify(b, null, 2);
}

export function toResultsJSON(results: EvalResult[]): string {
  return JSON.stringify(results, null, 2);
}

function csvCell(s: string | number | boolean): string {
  const v = String(s);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCSV(results: EvalResult[], rubric: Rubric): string {
  const dimIds = rubric.dimensions.map((d) => d.id);
  const header = ['testId', 'output', 'passed', ...dimIds.flatMap((id) => [`${id}_score`, `${id}_reasoning`])];
  const rows = results.map((r) => {
    const row: (string | number | boolean)[] = [r.testId, r.output, r.passed];
    for (const id of dimIds) {
      const s = r.scores.find((x) => x.dimensionId === id);
      row.push(s?.score ?? 0, s?.reasoning ?? '');
    }
    return row.map(csvCell).join(',');
  });
  return [header.join(','), ...rows].join('\r\n');
}
```

- [ ] **Step 4: Run to verify PASS.** Expect 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export.ts src/lib/__tests__/export.test.ts
git commit -m "feat: add export helpers (bundle JSON, results JSON, CSV)"
```

---

## Task 4: `buildRunEvalPrompt`

**Files:**
- Modify: `src/lib/prompts.ts` (append)
- Test: `src/lib/__tests__/prompts.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// Append to src/lib/__tests__/prompts.test.ts
import { buildRunEvalPrompt } from '@/lib/prompts';

it('buildRunEvalPrompt includes feature, all dimension ids, the test input, and JSON-only rule', () => {
  const prompt = buildRunEvalPrompt(
    sampleParsed, // existing fixture from earlier tests
    {
      dimensions: [
        { id: 'fidelity', label: 'F', description: 'd', weight: 0.5 },
        { id: 'brevity', label: 'B', description: 'd', weight: 0.5 },
      ],
    },
    { id: 'test-01', category: 'happy_path', input: 'literal user input here' },
  );
  expect(prompt).toContain(sampleParsed.feature);
  expect(prompt).toContain('fidelity');
  expect(prompt).toContain('brevity');
  expect(prompt).toContain('literal user input here');
  expect(prompt).toMatch(/json only/i);
});
```

- [ ] **Step 2: Run to verify FAIL.** Module exports `buildRunEvalPrompt` not yet added.

- [ ] **Step 3: Implement** (use the prompt locked in Task 0)

```ts
// Append to src/lib/prompts.ts
export function buildRunEvalPrompt(
  parsed: ParsedSpec,
  rubric: Rubric,
  test: TestCase,
): string {
  return `You are an evaluation engineer. The feature spec below describes an AI feature. Produce the feature output for the given input, then score that output on each rubric dimension.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs the feature expects:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs the feature produces:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints the output must satisfy:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Rubric dimensions:
${rubric.dimensions.map((d) => `- ${d.id}: ${d.label} — ${d.description}`).join('\n')}

Test input:
"""
${test.input}
"""

Respond with ONLY this JSON (no prose, no markdown):
{
  "output": "the feature output for the test input",
  "scores": [
    { "dimensionId": "...", "score": 0.0, "reasoning": "1-line justification" }
  ]
}

Rules:
- Score each dimension on a 0.0-1.0 scale where 1.0 means fully satisfied.
- Be honest. Penalize the output for failing constraints, even if the answer is otherwise good.
- Reasoning is one short sentence. No hedging.
- Output JSON only.`;
}
```

- [ ] **Step 4: Run to verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompts.ts src/lib/__tests__/prompts.test.ts
git commit -m "feat: add buildRunEvalPrompt for single-call output+self-score"
```

---

## Task 5: Type additions for run stage

**Files:**
- Modify: `src/lib/types.ts` (append)

- [ ] **Step 1: Write failing test** — append to `src/lib/__tests__/types.test.ts` if exists, else create:

```ts
// src/lib/__tests__/types.test.ts (create if missing, otherwise append)
import { describe, it, expectTypeOf } from 'vitest';
import type { RunSnapshot, RunEvent } from '@/lib/types';

describe('RunSnapshot/RunEvent', () => {
  it('RunEvent is a discriminated union', () => {
    const ev1: RunEvent = { type: 'started', total: 20 };
    const ev2: RunEvent = { type: 'progress', completed: 5, total: 20, partialResults: [] };
    const ev3: RunEvent = { type: 'done', results: [], summary: { overall: 0, passedCount: 0, perDimension: {} } };
    const ev4: RunEvent = { type: 'error', message: 'x' };
    expect([ev1, ev2, ev3, ev4]).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to FAIL.**

- [ ] **Step 3: Append types**

```ts
// Append to src/lib/types.ts
import type { Summary } from '@/lib/scoring';
export type RunSnapshot =
  | { kind: 'progress'; completed: number; total: number; partialResults: (EvalResult | Error)[] }
  | { kind: 'done'; results: EvalResult[]; summary: Summary };

export type RunEvent =
  | { type: 'started'; total: number }
  | { type: 'progress'; completed: number; total: number; partialResults: (EvalResult | Error)[] }
  | { type: 'done'; results: EvalResult[]; summary: Summary }
  | { type: 'error'; message: string };
```

Note on circular import: if `scoring.ts` ever imports from `types.ts`, switch to `import type` only. Should be safe — `types.ts` only adds the import.

- [ ] **Step 4: Run to PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/__tests__/types.test.ts
git commit -m "feat: add RunSnapshot and RunEvent types"
```

---

## Task 6: `/api/run-eval` SSE route

**Files:**
- Create: `src/app/api/run-eval/route.ts`
- Test: `src/app/api/run-eval/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/run-eval/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

const parsed: ParsedSpec = { feature: 'f', domain: 'general', inputs: [], outputs: [], constraints: [] };
const rubric: Rubric = { dimensions: [
  { id: 'a', label: 'A', description: '', weight: 1 },
]};
const tests: TestCase[] = [
  { id: 't1', category: 'happy_path', input: 'i1' },
  { id: 't2', category: 'happy_path', input: 'i2' },
];

beforeEach(() => vi.clearAllMocks());

it('rejects non-JSON body with 400', async () => {
  const { POST } = await import('@/app/api/run-eval/route');
  const res = await POST(new Request('http://x', { method: 'POST', body: 'not json' }));
  expect(res.status).toBe(400);
});

it('streams started → progress(es) → done with summary', async () => {
  const { generateJSON } = await import('@/lib/gemini');
  (generateJSON as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ output: 'o1', scores: [{ dimensionId: 'a', score: 1, reasoning: 'r' }] })
    .mockResolvedValueOnce({ output: 'o2', scores: [{ dimensionId: 'a', score: 0, reasoning: 'r' }] });

  const { POST } = await import('@/app/api/run-eval/route');
  const res = await POST(new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parsed, rubric, tests }),
  }));
  const events = await readSSEStream<{ type: string; [k: string]: unknown }>(res.body!);
  const types = events.map((e) => e.type);
  expect(types[0]).toBe('started');
  expect(types[types.length - 1]).toBe('done');
  const done = events.at(-1) as { type: 'done'; results: unknown[]; summary: { overall: number; passedCount: number } };
  expect(done.results).toHaveLength(2);
  expect(done.summary.overall).toBeCloseTo(0.5, 5);
});

it('emits error frame when generateJSON throws on first call', async () => {
  const { generateJSON } = await import('@/lib/gemini');
  (generateJSON as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

  const { POST } = await import('@/app/api/run-eval/route');
  const res = await POST(new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parsed, rubric, tests }),
  }));
  const events = await readSSEStream<{ type: string; message?: string }>(res.body!);
  // Per-item errors are returned as Error in partialResults, not thrown.
  // The route should still complete with done; the result entry is recorded as failed.
  // (Update assertion if you choose to escalate per-item errors to error frames.)
  const last = events.at(-1)!;
  expect(['done', 'error']).toContain(last.type);
});
```

- [ ] **Step 2: Run to FAIL** (route doesn't exist yet).

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/run-eval/route.ts
import type { NextRequest } from 'next/server';
import { generateJSON } from '@/lib/gemini';
import { runBatched } from '@/lib/runBatched';
import { buildRunEvalPrompt } from '@/lib/prompts';
import { summarize } from '@/lib/scoring';
import type { EvalResult, ParsedSpec, Rubric, TestCase, RunEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
};

const TICK_MS = 2000;
const PASS_THRESHOLD_DEFAULT = 0.7;

const enc = new TextEncoder();
const frame = (e: RunEvent) => enc.encode(`data: ${JSON.stringify(e)}\n\n`);

function isParsed(x: unknown): x is ParsedSpec {
  return !!x && typeof x === 'object' && 'feature' in x && 'domain' in x;
}
function isRubric(x: unknown): x is Rubric {
  return !!x && typeof x === 'object' && Array.isArray((x as { dimensions?: unknown }).dimensions);
}
function isTests(x: unknown): x is TestCase[] {
  return Array.isArray(x) && x.every((t) => t && typeof t === 'object' && 'id' in t && 'input' in t);
}

export async function POST(req: NextRequest | Request): Promise<Response> {
  let body: { parsed?: unknown; rubric?: unknown; tests?: unknown };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: { 'content-type': 'application/json' } }); }
  if (!isParsed(body.parsed) || !isRubric(body.rubric) || !isTests(body.tests)) {
    return new Response(JSON.stringify({ error: 'invalid body shape' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const { parsed, rubric, tests } = body as { parsed: ParsedSpec; rubric: Rubric; tests: TestCase[] };

  const stream = new ReadableStream({
    async start(controller) {
      let ticker: ReturnType<typeof setInterval> | null = null;
      let lastSnapshot: { completed: number; partialResults: (EvalResult | Error)[] } = { completed: 0, partialResults: [] };
      let closed = false;
      const safeEnqueue = (e: RunEvent) => { if (!closed) controller.enqueue(frame(e)); };
      const stop = () => {
        if (ticker) clearInterval(ticker);
        ticker = null;
        if (!closed) { closed = true; controller.close(); }
      };

      try {
        safeEnqueue({ type: 'started', total: tests.length });

        ticker = setInterval(() => {
          safeEnqueue({
            type: 'progress',
            completed: lastSnapshot.completed,
            total: tests.length,
            partialResults: lastSnapshot.partialResults,
          });
        }, TICK_MS);

        const judgeOne = async (test: TestCase): Promise<EvalResult> => {
          const raw = await generateJSON<{ output: string; scores: { dimensionId: string; score: number; reasoning: string }[] }>(
            buildRunEvalPrompt(parsed, rubric, test),
          );
          const passedScore = (raw.scores ?? []).reduce((acc, s) => {
            const dim = rubric.dimensions.find((d) => d.id === s.dimensionId);
            return acc + (dim ? s.score * dim.weight : 0);
          }, 0);
          return {
            testId: test.id,
            output: raw.output ?? '',
            scores: raw.scores ?? [],
            passed: passedScore >= PASS_THRESHOLD_DEFAULT,
          };
        };

        const partial = await runBatched<TestCase, EvalResult>(tests, judgeOne, {
          concurrency: 2,
          gapMs: 15000,
          signal: req.signal,
          onProgress: (completed, partialResults) => {
            lastSnapshot = { completed, partialResults };
          },
        });

        const results: EvalResult[] = partial.map((r, i) =>
          r instanceof Error
            ? { testId: tests[i].id, output: '', scores: [], passed: false }
            : r,
        );
        const summary = summarize(results, rubric, PASS_THRESHOLD_DEFAULT);

        safeEnqueue({ type: 'done', results, summary });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        safeEnqueue({ type: 'error', message });
      } finally {
        stop();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
```

- [ ] **Step 4: Run to PASS.** `npm run test:run -- src/app/api/run-eval`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/run-eval src/lib/types.ts
git commit -m "feat: add /api/run-eval SSE route with concurrent judge + ticker"
```

---

## Task 7: Extend `pageReducer` with `run` stage

**Files:**
- Modify: `src/lib/pageReducer.ts`
- Modify: `src/lib/__tests__/pageReducer.test.ts`

- [ ] **Step 1: Write failing tests** (append)

```ts
import type { RunSnapshot } from '@/lib/types';

it('run stage starts idle', () => {
  expect(initialState.stages.run.phase).toBe('idle');
});

it('STAGE_START sets run.phase generating', () => {
  const next = reducer(initialState, { type: 'STAGE_START', stage: 'run' });
  expect(next.stages.run.phase).toBe('generating');
});

it('progress event updates current snapshot', () => {
  const s1 = reducer(initialState, { type: 'STAGE_START', stage: 'run' });
  const s2 = reducer(s1, {
    type: 'STAGE_RUN_EVENT',
    event: { type: 'progress', completed: 3, total: 20, partialResults: [] },
  });
  expect((s2.stages.run.current as RunSnapshot).kind).toBe('progress');
});

it('done event sets done phase', () => {
  const s1 = reducer(initialState, { type: 'STAGE_START', stage: 'run' });
  const s2 = reducer(s1, {
    type: 'STAGE_RUN_EVENT',
    event: { type: 'done', results: [], summary: { overall: 0, passedCount: 0, perDimension: {} } },
  });
  expect(s2.stages.run.phase).toBe('done');
});

it('error event records state.error', () => {
  const s1 = reducer(initialState, { type: 'STAGE_START', stage: 'run' });
  const s2 = reducer(s1, { type: 'STAGE_RUN_EVENT', event: { type: 'error', message: 'x' } });
  expect(s2.stages.run.phase).toBe('error');
  expect(s2.error?.message).toBe('x');
});
```

- [ ] **Step 2: Run to FAIL.**

- [ ] **Step 3: Modify pageReducer**

Add `run: StageState<RunSnapshot>` to `PageState.stages`, update `idleStage` initialization, add `'run'` to `StageKey` (already a string union — extend), and add a new action variant + case:

```ts
// In PageAction union, add:
| { type: 'STAGE_RUN_EVENT'; event: RunEvent }

// In StageKey:
export type StageKey = 'parse' | 'tests' | 'rubric' | 'run';

// In PageState.stages:
run: StageState<RunSnapshot>;

// initialState.stages.run = idleStage<RunSnapshot>();

// In reducer():
case 'STAGE_RUN_EVENT': {
  const cur = state.stages.run;
  let phase = cur.phase;
  let current = cur.current as RunSnapshot | null;
  let error = state.error;
  if (action.event.type === 'progress') {
    current = { kind: 'progress', completed: action.event.completed, total: action.event.total, partialResults: action.event.partialResults };
  } else if (action.event.type === 'done') {
    phase = 'done';
    current = { kind: 'done', results: action.event.results, summary: action.event.summary };
  } else if (action.event.type === 'error') {
    phase = 'error';
    error = { stage: 'run', message: action.event.message, recoverable: false };
  }
  return { ...state, stages: { ...state.stages, run: { ...cur, phase, current } }, error };
}
```

- [ ] **Step 4: Run to PASS.** Full reducer suite + new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pageReducer.ts src/lib/__tests__/pageReducer.test.ts
git commit -m "feat(reducer): add run stage with snapshot/done/error handling"
```

---

## Task 8: `EvalRunButton` + `EvalProgress` components

**Files:**
- Create: `src/components/EvalRunButton.tsx`
- Create: `src/components/EvalProgress.tsx`
- Test: `src/components/__tests__/EvalRunButton.test.tsx`
- Test: `src/components/__tests__/EvalProgress.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// EvalRunButton.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EvalRunButton from '@/components/EvalRunButton';

it('calls onRun when clicked, disabled while running', async () => {
  const onRun = vi.fn();
  const { rerender } = render(<EvalRunButton onRun={onRun} running={false} />);
  await userEvent.click(screen.getByRole('button'));
  expect(onRun).toHaveBeenCalled();
  rerender(<EvalRunButton onRun={onRun} running={true} />);
  expect(screen.getByRole('button')).toBeDisabled();
});
```

```tsx
// EvalProgress.test.tsx
import EvalProgress from '@/components/EvalProgress';
it('renders completed/total and percentage', () => {
  render(<EvalProgress completed={5} total={20} />);
  expect(screen.getByText(/5\s*\/\s*20/)).toBeInTheDocument();
  expect(screen.getByText(/25%/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to FAIL.**

- [ ] **Step 3: Implement** (Tailwind classes follow existing patterns; copy from `SpecForm.tsx` for button styling).

```tsx
// src/components/EvalRunButton.tsx
'use client';
type Props = { onRun: () => void; running: boolean };
export default function EvalRunButton({ onRun, running }: Props) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={running}
      className="self-start rounded-md border border-border bg-fg px-4 py-2 font-mono text-sm text-bg disabled:opacity-50"
    >
      {running ? 'Running…' : 'Run 20 evals'}
    </button>
  );
}
```

```tsx
// src/components/EvalProgress.tsx
type Props = { completed: number; total: number };
export default function EvalProgress({ completed, total }: Props) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between font-mono text-xs text-muted">
        <span>{completed} / {total}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-md bg-surface">
        <div className="h-full bg-fg transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/components/EvalRunButton.tsx src/components/EvalProgress.tsx src/components/__tests__/EvalRunButton.test.tsx src/components/__tests__/EvalProgress.test.tsx
git commit -m "feat(components): add EvalRunButton and EvalProgress"
```

---

## Task 9: `ResultsTable` component

**Files:**
- Create: `src/components/ResultsTable.tsx`
- Test: `src/components/__tests__/ResultsTable.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import ResultsTable from '@/components/ResultsTable';
import type { EvalResult, Rubric } from '@/lib/types';

const rubric: Rubric = { dimensions: [{ id: 'a', label: 'A', description: '', weight: 1 }] };
const results: EvalResult[] = [
  { testId: 't1', output: 'good', passed: true, scores: [{ dimensionId: 'a', score: 0.9, reasoning: 'why' }] },
];

it('renders one row per result with output and pass/fail', () => {
  render(<ResultsTable results={results} rubric={rubric} threshold={0.7} />);
  expect(screen.getByText('t1')).toBeInTheDocument();
  expect(screen.getByText(/pass/i)).toBeInTheDocument();
});

it('expands row to show reasoning on click', async () => {
  render(<ResultsTable results={results} rubric={rubric} threshold={0.7} />);
  await userEvent.click(screen.getByText('t1'));
  expect(screen.getByText('why')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to FAIL.**

- [ ] **Step 3: Implement** — table with one row per result, click row to expand showing per-dim scores + reasoning. Use `useMemo` to recompute pass/fail from `weightedOverall(r.scores, rubric) >= threshold`. Use `useState<Set<string>>` for expanded row ids.

- [ ] **Step 4: Run to PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/components/ResultsTable.tsx src/components/__tests__/ResultsTable.test.tsx
git commit -m "feat(components): add ResultsTable with expandable rows"
```

---

## Task 10: `Scorecard` + `ExportButtons`

**Files:**
- Create: `src/components/Scorecard.tsx`
- Create: `src/components/ExportButtons.tsx`
- Test: `src/components/__tests__/Scorecard.test.tsx`
- Test: `src/components/__tests__/ExportButtons.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// Scorecard.test.tsx
import Scorecard from '@/components/Scorecard';
const rubric = { dimensions: [{ id: 'a', label: 'A', description: '', weight: 1 }] };
const results = [
  { testId: 't1', output: 'x', passed: true, scores: [{ dimensionId: 'a', score: 0.9, reasoning: '' }] },
  { testId: 't2', output: 'x', passed: true, scores: [{ dimensionId: 'a', score: 0.4, reasoning: '' }] },
];
it('renders headline overall and N of total passed', () => {
  render(<Scorecard results={results} rubric={rubric} />);
  expect(screen.getByText(/0\.65|0\.6\d/)).toBeInTheDocument(); // overall avg
  expect(screen.getByText(/1\s*of\s*2/i)).toBeInTheDocument();
});
it('slider re-tags pass/fail without API call', async () => {
  render(<Scorecard results={results} rubric={rubric} />);
  const slider = screen.getByRole('slider');
  await userEvent.click(slider); // focus
  // Adjust to 1.0 → none passed
  fireEvent.change(slider, { target: { value: '1' } });
  expect(screen.getByText(/0\s*of\s*2/i)).toBeInTheDocument();
});
```

```tsx
// ExportButtons.test.tsx — assert click triggers download (mock URL.createObjectURL + click)
```

- [ ] **Step 2: Run to FAIL.**

- [ ] **Step 3: Implement**

`Scorecard` holds `useState<number>(0.7)` for threshold, computes `summary = useMemo(() => summarize(results, rubric, threshold), [results, rubric, threshold])`. Renders headline, "N of M passed", per-dim bars, threshold slider (`<input type="range" min="0.5" max="1" step="0.05">`), and embeds `<ResultsTable threshold={threshold} ... />`. Embeds `<ExportButtons spec parsed tests rubric results summary />`.

`ExportButtons` renders 3 buttons. Each click: create Blob, `URL.createObjectURL`, set `<a href download>` and click. Filenames: `evalforge-bundle.json`, `evalforge-results.json`, `evalforge-results.csv`.

- [ ] **Step 4: Run to PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/components/Scorecard.tsx src/components/ExportButtons.tsx src/components/__tests__/Scorecard.test.tsx src/components/__tests__/ExportButtons.test.tsx
git commit -m "feat(components): add Scorecard with threshold slider and ExportButtons"
```

---

## Task 11: Wire run stage into `page.tsx` + 5000-char cap + metadata

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/SpecForm.tsx` (add maxLength + counter)
- Modify: `src/app/layout.tsx` (Next.js metadata export)
- Modify: `src/app/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// Append to page.test.tsx
it('renders Run 20 evals button after rubric stage completes', async () => {
  // Mock 3 SSE streams to complete parse, tests, rubric quickly, then assert button visible
});

it('clicking Run 20 evals starts run stage and renders Scorecard on done', async () => {
  // Mock 4th SSE stream with started → progress → done; assert Scorecard renders
});
```

```tsx
// SpecForm.test.tsx — append
it('shows character counter and prevents typing past 5000 chars', async () => {
  render(<SpecForm onSubmit={() => {}} />);
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(textarea).toHaveAttribute('maxlength', '5000');
});
```

- [ ] **Step 2: Run to FAIL.**

- [ ] **Step 3: Implement**

- In `SpecForm.tsx`: add `maxLength={5000}` to textarea, add `<p className="font-mono text-xs text-muted">{value.length} / 5000</p>` below.
- In `page.tsx`: import `EvalRunButton`, `EvalProgress`, `Scorecard`. Add `runRunStage` (analogous to `runStage` but typed for `RunEvent`). Render the button after `rubric.phase === 'done'`. When clicked: `dispatch(STAGE_START stage='run')` + open `/api/run-eval` SSE. While `run.phase === 'generating'`: render `EvalProgress` from `state.stages.run.current` (if `kind === 'progress'`). When `run.phase === 'done'`: render `Scorecard` with the final results.
- In `layout.tsx`: add `export const metadata = { title: 'EvalForge — AI evals from one paste', description: '...', openGraph: { ... } };`.

- [ ] **Step 4: Run to PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/SpecForm.tsx src/app/layout.tsx src/app/__tests__/page.test.tsx src/components/__tests__/SpecForm.test.tsx
git commit -m "feat(page): wire run stage, add 5000-char cap and meta tags"
```

---

## Task 12: Mobile responsiveness pass

**Files:**
- Modify: `src/components/ResultsTable.tsx`, `src/components/Scorecard.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Manually test at 375px width** — open dev server, use DevTools responsive mode.

- [ ] **Step 2: Add Tailwind `sm:` breakpoints** where layout breaks. Common spots:
  - ResultsTable: stack columns vertically on small screens, or hide less important columns (`hidden sm:table-cell`).
  - Scorecard: stack headline + slider vertically below `sm:`.
  - Page: tighten padding on mobile.

- [ ] **Step 3: Re-test at 375px, 768px, 1280px.**

- [ ] **Step 4: Commit**

```bash
git add src/components src/app/page.tsx
git commit -m "style: mobile responsive Scorecard and ResultsTable"
```

---

## Task 13: Manual smoke + final verification (gate)

**This task gates the plan.** Each example chip must produce: parsed → 20 tests → rubric → run-eval → scorecard with 20 results, all live-streaming, completing in ~90–120s.

- [ ] **Step 1:** Confirm `.env.local` has a real `GEMINI_API_KEY`.
- [ ] **Step 2:** `npm run dev`.
- [ ] **Step 3:** For each chip (Legal, Sales, Healthcare):
  - Click chip → click Generate Eval Suite.
  - Wait for parsed + tests + rubric (with refinement loop status).
  - Click Run 20 evals.
  - Watch progress bar tick from 0 → 20.
  - Verify Scorecard shows: overall (0.0–1.0), N of 20 passed, per-dim bars.
  - Drag threshold slider — pass count updates live, no network call.
  - Click each export button — verify file downloads with expected name and content.
  - Open DevTools Network: confirm 1 SSE response from `/api/run-eval` with snapshot frames.
- [ ] **Step 4:** `npm run test:run` — confirm all tests pass.
- [ ] **Step 5:** `npm run lint` — clean.
- [ ] **Step 6:** `npm run build` — clean.
- [ ] **Step 7:** Optional: tweak `buildRunEvalPrompt` if scores look uniformly inflated. Commit any tweaks.

---

## Done-when checklist

- [ ] All 13 tasks committed.
- [ ] Test suite green (target: ~125 tests).
- [ ] Lint clean.
- [ ] Build clean.
- [ ] All 3 example chips smoke-test successfully end-to-end with live streaming and scorecard.
- [ ] Threshold slider re-tags pass/fail without re-running.
- [ ] All 3 export formats download with valid content.
- [ ] Mobile layout works at 375px width.
