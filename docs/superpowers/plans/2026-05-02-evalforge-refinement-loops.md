# EvalForge Refinement Loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap each of the three pipeline stages (`parse-spec`, `generate-tests`, `generate-rubric`) in a bounded `generate → critique → revise` loop, streamed to the client via SSE, with live intermediate output.

**Architecture:** A new `lib/refinement.ts` module owns the loop logic as an async generator yielding `RefinementEvent`s. Each existing route handler becomes an SSE producer that consumes the generator and writes one `data: {…}\n\n` frame per event. The page client (`page.tsx`) opens three sequential SSE connections, parsing frames with `fetch().body.getReader()` and dispatching each as a reducer action that drives a per-stage state machine. `lib/prompts.ts` grows from 3 to 9 builders (adds critique + revise per stage). No new infrastructure.

**Tech Stack:** Next.js 16.2.4 App Router (Node runtime), `@google/genai` 1.51.0, Tailwind v4 tokens, Vitest + RTL + jsdom, native `ReadableStream` for SSE.

**Reference docs to consult before writing code:**
- `docs/superpowers/specs/2026-05-02-evalforge-refinement-loops-design.md` — the canonical design.
- `node_modules/next/dist/docs/01-app/02-guides/route-handlers.mdx` (or equivalent index) — verify Next.js 16 streaming Response shape.
- Existing `src/lib/gemini.ts` — `generateJSON<T>` already exists, do **not** re-add it.

**Tested model id:** `gemini-2.5-flash` (unchanged from Plan B).

---

## Pre-flight

- [ ] **PF.1: Confirm branch and clean tree**

```bash
git rev-parse --abbrev-ref HEAD   # expect: feat/refinement-loops
git status -sb                    # expect: clean
git log --oneline -3              # expect: design spec commit on top of merged Plan B
```

- [ ] **PF.2: Run baseline tests + build**

```bash
npm run test:run
npm run lint
npm run build
```

Expected: 70/70 tests pass, lint clean, build clean. Do not start tasks if anything is red.

- [ ] **PF.3: Read the design spec end-to-end**

Open `docs/superpowers/specs/2026-05-02-evalforge-refinement-loops-design.md`. Every requirement in this plan traces back to a section in that spec.

---

## File Structure

**New files:**
- `src/lib/refinement.ts` — async generator implementing the loop. Pure orchestration; no I/O of its own.
- `src/lib/__tests__/refinement.test.ts` — unit tests with stubbed generate/critique/revise.
- `src/test/sse-stream.ts` — tiny test helper that builds a fake SSE `Response`. Shared between route + page integration tests.

**Modified files:**
- `src/lib/types.ts` — adds `Issue` and `RefinementEvent<T>`.
- `src/lib/prompts.ts` — adds 6 new builders (3 critique + 3 revise).
- `src/lib/__tests__/prompts.test.ts` — extends with assertions for the 6 new builders.
- `src/app/api/parse-spec/route.ts` — refactor: returns SSE stream.
- `src/app/api/parse-spec/__tests__/route.test.ts` — rewrite: asserts SSE event sequence.
- `src/app/api/generate-tests/route.ts` — same refactor as parse-spec.
- `src/app/api/generate-tests/__tests__/route.test.ts` — same rewrite.
- `src/app/api/generate-rubric/route.ts` — same refactor.
- `src/app/api/generate-rubric/__tests__/route.test.ts` — same rewrite.
- `src/lib/pageReducer.ts` — rewrite: per-stage `StageState`, new actions.
- `src/lib/__tests__/pageReducer.test.ts` — rewrite: tests for new actions/transitions.
- `src/app/page.tsx` — replace `postJSON` with `runStage` SSE consumer; status text computed from reducer.
- `src/app/__tests__/page.test.tsx` (new) — integration test using mocked SSE streams.

**Unchanged files:** `src/lib/gemini.ts`, `src/components/*` (DomainBadge, TestSuiteTable, RubricPanel, SpecForm, SpecInput), `src/lib/examples.ts`.

---

## Task 1: Type additions

**Files:**
- Modify: `src/lib/types.ts`

No tests — pure type additions; if they're wrong, every downstream compile fails loudly.

- [ ] **Step 1.1: Append types to `src/lib/types.ts`**

Append after the existing `EvalResult` block:

```ts
// ──────────────────────────────────────────────────────────────────────────
// Refinement loop (Sub-project 1)
// ──────────────────────────────────────────────────────────────────────────

// Issues are produced by critique calls and consumed by revise calls.
// `field` is a JSON path into the stage's output (e.g. "tests[3].category").
export type Issue = {
  field: string;
  severity: 'minor' | 'major';
  description: string;
  suggestion: string;
};

// Events emitted by `runRefinement` and serialized over SSE.
export type RefinementEvent<T> =
  | { type: 'generated'; pass: 0; output: T }
  | { type: 'critiquing'; pass: 1 | 2 }
  | { type: 'critiqued'; pass: 1 | 2; issues: Issue[] }
  | { type: 'revising'; pass: 1 | 2 }
  | { type: 'revised'; pass: 1 | 2; output: T }
  | { type: 'done'; output: T }
  | { type: 'error'; message: string };
```

- [ ] **Step 1.2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 1.3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add Issue and RefinementEvent types for refinement loops"
```

---

## Task 2: SSE test helper

**Files:**
- Create: `src/test/sse-stream.ts`

No tests for the helper itself — it's trivial test infrastructure. If it's broken, every consuming test will fail and surface the bug.

- [ ] **Step 2.1: Create `src/test/sse-stream.ts`**

```ts
// Builds a fake SSE Response from a list of events.
// Each event is serialized as one `data: <json>\n\n` frame.
// Used by route-handler tests and page integration tests.
export function mockSSEStream(events: object[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

// Drains an SSE Response (as produced by a route handler) into an array
// of parsed event objects. Used by route-handler tests to assert the
// frame sequence emitted by a real handler.
export async function readSSEStream<T = unknown>(res: Response): Promise<T[]> {
  if (!res.body) throw new Error('Response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const out: T[] = [];
  // SSE frames are separated by a blank line ("\n\n"). We accumulate raw
  // chunks, split on the delimiter, and parse the `data: ` payload.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) out.push(JSON.parse(line.slice(6)) as T);
    }
  }
  return out;
}
```

- [ ] **Step 2.2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/test/sse-stream.ts
git commit -m "feat: add SSE test helpers (mockSSEStream, readSSEStream)"
```

---

## Task 3: `lib/refinement.ts` core loop (TDD)

**Files:**
- Create: `src/lib/refinement.ts`
- Create: `src/lib/__tests__/refinement.test.ts`

This is the heart of the feature. Tests come first.

- [ ] **Step 3.1: Write the failing tests**

Create `src/lib/__tests__/refinement.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runRefinement } from '@/lib/refinement';
import type { Issue, RefinementEvent } from '@/lib/types';

async function collect<T>(gen: AsyncGenerator<RefinementEvent<T>>): Promise<RefinementEvent<T>[]> {
  const out: RefinementEvent<T>[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const noIssues: Issue[] = [];
const majorIssue: Issue = {
  field: 'feature',
  severity: 'major',
  description: 'fix me',
  suggestion: 'fix it',
};

describe('runRefinement', () => {
  it('exits after first critique when no major issues', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockResolvedValue(noIssues);
    const revise = vi.fn();
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'done',
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(critique).toHaveBeenCalledTimes(1);
    expect(revise).not.toHaveBeenCalled();
  });

  it('runs one revise round when first critique flags major issues, then exits clean', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi
      .fn()
      .mockResolvedValueOnce([majorIssue])
      .mockResolvedValueOnce(noIssues);
    const revise = vi.fn().mockResolvedValue({ v: 1 });
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'revising',
      'revised',
      'critiquing',
      'critiqued',
      'done',
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(critique).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(1);
  });

  it('caps at N=2 even when issues persist; emits done with the last revised output', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockResolvedValue([majorIssue]);
    const revise = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });
    const events = await collect(runRefinement({ generate, critique, revise }));
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'revising',
      'revised',
      'critiquing',
      'critiqued',
      'revising',
      'revised',
      'done',
    ]);
    const final = events.find((e) => e.type === 'done')!;
    expect((final as { output: { v: number } }).output).toEqual({ v: 2 });
    expect(critique).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(2);
  });

  it('treats minor-only issues as clean and exits', async () => {
    const minor: Issue = { ...majorIssue, severity: 'minor' };
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockResolvedValue([minor]);
    const revise = vi.fn();
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual(['generated', 'critiquing', 'critiqued', 'done']);
    expect(revise).not.toHaveBeenCalled();
  });

  it('emits an error event and stops if generate throws', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('boom'));
    const critique = vi.fn();
    const revise = vi.fn();
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events).toEqual([{ type: 'error', message: 'boom' }]);
    expect(critique).not.toHaveBeenCalled();
  });

  it('emits an error event and stops if revise throws', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockResolvedValue([majorIssue]);
    const revise = vi.fn().mockRejectedValue(new Error('revise failed'));
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'revising',
      'error',
    ]);
  });

  it('treats critique that throws as clean (logs warn, exits loop with current output)', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockRejectedValue(new Error('parse failed'));
    const revise = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual(['generated', 'critiquing', 'critiqued', 'done']);
    const last = events.at(-1) as { type: 'done'; output: { v: number } };
    expect(last.output).toEqual({ v: 0 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('aborts cleanly when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn();
    const revise = vi.fn();
    const events = await collect(
      runRefinement({ generate, critique, revise, signal: controller.signal }),
    );
    expect(events).toEqual([{ type: 'error', message: 'aborted' }]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('preserves the pass counter on critiqued and revised events', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi
      .fn()
      .mockResolvedValueOnce([majorIssue])
      .mockResolvedValueOnce([majorIssue])
      .mockResolvedValueOnce(noIssues);
    const revise = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });
    const events = await collect(runRefinement({ generate, critique, revise }));
    const passes = events
      .filter((e) => 'pass' in e)
      .map((e) => (e as { pass: number }).pass);
    // generated:0 critiquing:1 critiqued:1 revising:1 revised:1 critiquing:2 critiqued:2 ...
    expect(passes.slice(0, 7)).toEqual([0, 1, 1, 1, 1, 2, 2]);
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/refinement.test.ts`
Expected: FAIL — `Cannot find module '@/lib/refinement'` or similar.

- [ ] **Step 3.3: Create `src/lib/refinement.ts`**

```ts
import type { Issue, RefinementEvent } from '@/lib/types';

export type RefinementInputs<T> = {
  generate: () => Promise<T>;
  critique: (output: T) => Promise<Issue[]>;
  revise: (output: T, issues: Issue[]) => Promise<T>;
  signal?: AbortSignal;
  // Max revise rounds. Defaults to 2 per the design spec.
  maxPasses?: 1 | 2 | 3;
};

const MAX_PASSES_DEFAULT = 2;

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

// Bounded generate → critique → revise loop.
// Yields one RefinementEvent per phase boundary so the route handler can
// stream them to the client. The loop exits early when a critique returns
// no major issues; it caps at `maxPasses` revise rounds otherwise.
export async function* runRefinement<T>(
  inputs: RefinementInputs<T>,
): AsyncGenerator<RefinementEvent<T>> {
  const { generate, critique, revise, signal } = inputs;
  const maxPasses = inputs.maxPasses ?? MAX_PASSES_DEFAULT;

  if (isAborted(signal)) {
    yield { type: 'error', message: 'aborted' };
    return;
  }

  let output: T;
  try {
    output = await generate();
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }
  yield { type: 'generated', pass: 0, output };

  for (let pass = 1; pass <= maxPasses; pass++) {
    if (isAborted(signal)) {
      yield { type: 'error', message: 'aborted' };
      return;
    }

    yield { type: 'critiquing', pass: pass as 1 | 2 };

    let issues: Issue[];
    try {
      issues = await critique(output);
    } catch (err) {
      // Critique failure is non-fatal: treat as clean and exit cleanly.
      console.warn('[refinement] critique threw; treating as clean:', err);
      issues = [];
    }
    yield { type: 'critiqued', pass: pass as 1 | 2, issues };

    const major = issues.filter((i) => i.severity === 'major');
    if (major.length === 0) break;

    if (isAborted(signal)) {
      yield { type: 'error', message: 'aborted' };
      return;
    }

    yield { type: 'revising', pass: pass as 1 | 2 };

    try {
      output = await revise(output, major);
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      return;
    }
    yield { type: 'revised', pass: pass as 1 | 2, output };
  }

  yield { type: 'done', output };
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `npm run test:run -- src/lib/__tests__/refinement.test.ts`
Expected: PASS — 9/9 tests.

- [ ] **Step 3.5: Run the full suite**

Run: `npm run test:run`
Expected: PASS — 79/79 (70 baseline + 9 new).

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/refinement.ts src/lib/__tests__/refinement.test.ts
git commit -m "feat: add bounded refinement loop generator"
```

---

## Task 4: Parse-spec critique + revise prompt builders (TDD)

**Files:**
- Modify: `src/lib/prompts.ts`
- Modify: `src/lib/__tests__/prompts.test.ts`

- [ ] **Step 4.1: Append failing tests**

Append to `src/lib/__tests__/prompts.test.ts`:

```ts
import {
  buildParseSpecCritiquePrompt,
  buildParseSpecRevisePrompt,
} from '@/lib/prompts';
import type { ParsedSpec, Issue } from '@/lib/types';

const sampleParsed: ParsedSpec = {
  feature: 'Extracts obligations from contract PDFs.',
  inputs: ['contract pdf'],
  outputs: ['table of obligations'],
  constraints: ['must include due date'],
  domain: 'legal',
};

const sampleSpec = 'AI extracts obligations from a contract pdf.';

const sampleIssue: Issue = {
  field: 'feature',
  severity: 'major',
  description: 'Summary omits clause-level extraction.',
  suggestion: 'Mention clause-level extraction explicitly.',
};

describe('buildParseSpecCritiquePrompt', () => {
  it('embeds the original spec, the parsed JSON, and the JSON-only output instruction', () => {
    const prompt = buildParseSpecCritiquePrompt(sampleSpec, sampleParsed);
    expect(prompt).toContain(sampleSpec);
    expect(prompt).toContain(JSON.stringify(sampleParsed));
    expect(prompt).toMatch(/issues/i);
    expect(prompt).toMatch(/severity/i);
    expect(prompt).toMatch(/JSON/);
  });

  it('includes every checklist item from the spec', () => {
    const prompt = buildParseSpecCritiquePrompt(sampleSpec, sampleParsed);
    for (const cue of [
      'domain correctness',
      'feature summary',
      'inputs',
      'outputs',
      'constraints',
      'no hallucination',
      'granularity',
    ]) {
      expect(prompt.toLowerCase()).toContain(cue);
    }
  });
});

describe('buildParseSpecRevisePrompt', () => {
  it('embeds the current parsed JSON and renders each issue as a bullet', () => {
    const prompt = buildParseSpecRevisePrompt(sampleParsed, [sampleIssue]);
    expect(prompt).toContain(JSON.stringify(sampleParsed));
    expect(prompt).toContain(sampleIssue.field);
    expect(prompt).toContain(sampleIssue.description);
    expect(prompt).toContain(sampleIssue.suggestion);
    expect(prompt).toMatch(/preserve/i);
    expect(prompt).toMatch(/JSON/);
  });

  it('does NOT embed the original spec (revise must work from output + issues only)', () => {
    const prompt = buildParseSpecRevisePrompt(sampleParsed, [sampleIssue]);
    expect(prompt).not.toContain(sampleSpec);
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/prompts.test.ts`
Expected: FAIL — `buildParseSpecCritiquePrompt is not exported from '@/lib/prompts'`.

- [ ] **Step 4.3: Append builders to `src/lib/prompts.ts`**

Append after `buildParseSpecPrompt`:

```ts
import type { Issue } from '@/lib/types';

function renderIssues(issues: Issue[]): string {
  return issues
    .map(
      (i) =>
        `- [${i.severity}] ${i.field}: ${i.description} Suggestion: ${i.suggestion}`,
    )
    .join('\n');
}

export function buildParseSpecCritiquePrompt(
  spec: string,
  parsed: ParsedSpec,
): string {
  return `You are an evaluation engineer reviewing a parsed feature spec.

Original spec:
"""
${spec}
"""

Parsed JSON:
${JSON.stringify(parsed)}

Evaluate the parsed JSON against this checklist. For every violation, emit one issue:
1. Domain correctness — domain is one of legal | sales | healthcare | general and matches the spec.
2. Feature summary fidelity — the feature field is a faithful one-line summary; no facts not present in the spec.
3. Inputs completeness — every distinct input the AI receives, per the spec, is in inputs.
4. Outputs completeness — every distinct output the AI produces is in outputs.
5. Constraints completeness — every requirement the output must satisfy is in constraints.
6. No hallucination — no item in inputs/outputs/constraints is unsupported by the spec.
7. Granularity — items are 1-6 short, specific bullets per list; no duplicates.

For each violation, emit an issue object:
{
  "field": "JSON path into the parsed object, e.g. inputs[0]",
  "severity": "major" | "minor",
  "description": "what is wrong",
  "suggestion": "how to fix"
}

Use "major" only for issues that would invalidate downstream test/rubric generation. Style nits are "minor".

Respond with ONLY this JSON (no prose, no markdown):
{ "issues": [ ... ] }

If everything is correct, respond with: { "issues": [] }`;
}

export function buildParseSpecRevisePrompt(
  current: ParsedSpec,
  issues: Issue[],
): string {
  return `You produced this parsed spec JSON:
${JSON.stringify(current)}

A reviewer found these issues:
${renderIssues(issues)}

Produce a corrected ParsedSpec that:
1. Fixes EVERY listed issue.
2. Preserves all unflagged content unchanged.
3. Returns the SAME schema shape — exactly these top-level fields: feature, inputs, outputs, constraints, domain.
4. Does not introduce new fields and does not omit any.

Respond with ONLY the corrected JSON object (no prose, no markdown).`;
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `npm run test:run -- src/lib/__tests__/prompts.test.ts`
Expected: PASS — all existing prompt tests + 4 new.

- [ ] **Step 4.5: Run the full suite**

Run: `npm run test:run`
Expected: 83/83 (79 + 4 new).

- [ ] **Step 4.6: Commit**

```bash
git add src/lib/prompts.ts src/lib/__tests__/prompts.test.ts
git commit -m "feat: add parse-spec critique and revise prompt builders"
```

---

## Task 5: Refactor `/api/parse-spec` to SSE (TDD)

**Files:**
- Modify: `src/app/api/parse-spec/route.ts`
- Modify: `src/app/api/parse-spec/__tests__/route.test.ts`

The route's contract changes: no more JSON Response; it returns an SSE stream of `RefinementEvent`s. Tests must be rewritten before implementation.

- [ ] **Step 5.1: Replace `src/app/api/parse-spec/__tests__/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/parse-spec/route';
import { readSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, RefinementEvent } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { generateJSON } from '@/lib/gemini';

const sampleParsed: ParsedSpec = {
  feature: 'Extracts obligations from contracts.',
  inputs: ['contract pdf'],
  outputs: ['table of obligations'],
  constraints: ['include due date'],
  domain: 'legal',
};

const cleanCritique = { issues: [] };

function jsonReq(body: unknown): Request {
  return new Request('http://test/api/parse-spec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(generateJSON).mockReset();
});

describe('POST /api/parse-spec (SSE)', () => {
  it('rejects non-JSON body with 400 (no SSE)', async () => {
    const req = new Request('http://test/api/parse-spec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/json/);
  });

  it('rejects empty spec with 400', async () => {
    const res = await POST(jsonReq({ spec: '   ' }));
    expect(res.status).toBe(400);
  });

  it('streams generated → critiquing → critiqued → done when first critique is clean', async () => {
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleParsed)        // generate
      .mockResolvedValueOnce(cleanCritique);      // critique pass 1
    const res = await POST(jsonReq({ spec: 'AI parses contracts.' }));
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = await readSSEStream<RefinementEvent<ParsedSpec>>(res);
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'done',
    ]);
  });

  it('streams a full revise round when first critique flags major issues, then exits', async () => {
    const issue = {
      field: 'feature',
      severity: 'major' as const,
      description: 'too vague',
      suggestion: 'be specific',
    };
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleParsed)                          // generate
      .mockResolvedValueOnce({ issues: [issue] })                   // critique 1
      .mockResolvedValueOnce({ ...sampleParsed, feature: 'better' })// revise 1
      .mockResolvedValueOnce(cleanCritique);                        // critique 2
    const res = await POST(jsonReq({ spec: 'AI parses contracts.' }));
    const events = await readSSEStream<RefinementEvent<ParsedSpec>>(res);
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'revising',
      'revised',
      'critiquing',
      'critiqued',
      'done',
    ]);
  });

  it('emits an error event when generate throws', async () => {
    vi.mocked(generateJSON).mockRejectedValueOnce(new Error('gemini down'));
    const res = await POST(jsonReq({ spec: 'AI parses contracts.' }));
    const events = await readSSEStream<RefinementEvent<ParsedSpec>>(res);
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect((events[0] as { message: string }).message).toContain('gemini down');
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `npm run test:run -- src/app/api/parse-spec`
Expected: FAIL — assertions fail because the current handler returns plain JSON, not SSE.

- [ ] **Step 5.3: Replace `src/app/api/parse-spec/route.ts`**

```ts
import { generateJSON } from '@/lib/gemini';
import {
  buildParseSpecPrompt,
  buildParseSpecCritiquePrompt,
  buildParseSpecRevisePrompt,
} from '@/lib/prompts';
import { runRefinement } from '@/lib/refinement';
import type { Issue, ParsedSpec, RefinementEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

function frame(event: RefinementEvent<ParsedSpec>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const spec = (body as { spec?: unknown }).spec;
  if (typeof spec !== 'string' || spec.trim().length === 0) {
    return Response.json({ error: 'spec must be a non-empty string.' }, { status: 400 });
  }
  const trimmed = spec.trim();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const generator = runRefinement<ParsedSpec>({
        generate: () => generateJSON<ParsedSpec>(buildParseSpecPrompt(trimmed)),
        critique: async (current) => {
          const result = await generateJSON<{ issues: Issue[] }>(
            buildParseSpecCritiquePrompt(trimmed, current),
          );
          return Array.isArray(result?.issues) ? result.issues : [];
        },
        revise: (current, issues) =>
          generateJSON<ParsedSpec>(buildParseSpecRevisePrompt(current, issues)),
        signal: req.signal,
      });
      try {
        for await (const evt of generator) {
          controller.enqueue(encoder.encode(frame(evt)));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `npm run test:run -- src/app/api/parse-spec`
Expected: PASS — 5/5 route tests.

- [ ] **Step 5.5: Run the full suite**

Run: `npm run test:run`
Expected: 84/84 (83 + 5 new − 4 deleted from old test file). Adjust target if exact count differs; what matters is everything passes.

- [ ] **Step 5.6: Commit**

```bash
git add src/app/api/parse-spec/route.ts src/app/api/parse-spec/__tests__/route.test.ts
git commit -m "feat: refactor /api/parse-spec to SSE with refinement loop"
```

---

## Task 6: Generate-tests critique + revise prompt builders (TDD)

**Files:**
- Modify: `src/lib/prompts.ts`
- Modify: `src/lib/__tests__/prompts.test.ts`

- [ ] **Step 6.1: Append failing tests**

Append to `src/lib/__tests__/prompts.test.ts`:

```ts
import {
  buildGenerateTestsCritiquePrompt,
  buildGenerateTestsRevisePrompt,
} from '@/lib/prompts';
import type { TestCase } from '@/lib/types';

const sampleTests: TestCase[] = Array.from({ length: 20 }, (_, i) => ({
  id: `test-${String(i + 1).padStart(2, '0')}`,
  category: i < 8 ? 'happy_path' : i < 15 ? 'edge_case' : 'adversarial',
  input: `sample input ${i + 1}`,
}));

describe('buildGenerateTestsCritiquePrompt', () => {
  it('embeds the parsed spec and the tests array', () => {
    const prompt = buildGenerateTestsCritiquePrompt(sampleParsed, sampleTests);
    expect(prompt).toContain(sampleParsed.feature);
    expect(prompt).toContain(JSON.stringify(sampleTests));
    expect(prompt).toMatch(/issues/i);
  });

  it('includes every checklist item from the spec', () => {
    const prompt = buildGenerateTestsCritiquePrompt(sampleParsed, sampleTests);
    for (const cue of [
      'count',
      'distribution',
      'concrete',
      'coverage',
      'constraints',
      'adversarial',
      'realism',
      'specificity',
    ]) {
      expect(prompt.toLowerCase()).toContain(cue);
    }
  });
});

describe('buildGenerateTestsRevisePrompt', () => {
  it('embeds the current tests and renders each issue as a bullet', () => {
    const issue: Issue = {
      field: 'tests[3].category',
      severity: 'major',
      description: 'mislabeled',
      suggestion: 'reclassify',
    };
    const prompt = buildGenerateTestsRevisePrompt(sampleTests, [issue]);
    expect(prompt).toContain(JSON.stringify(sampleTests));
    expect(prompt).toContain(issue.field);
    expect(prompt).toContain(issue.description);
    expect(prompt).toContain(issue.suggestion);
    expect(prompt).toMatch(/preserve/i);
  });

  it('does NOT embed the parsed spec', () => {
    const issue: Issue = {
      field: 'tests[0].input',
      severity: 'major',
      description: 'too vague',
      suggestion: 'be specific',
    };
    const prompt = buildGenerateTestsRevisePrompt(sampleTests, [issue]);
    expect(prompt).not.toContain(sampleParsed.feature);
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/prompts.test.ts`
Expected: FAIL — `buildGenerateTestsCritiquePrompt is not exported`.

- [ ] **Step 6.3: Append builders to `src/lib/prompts.ts`**

```ts
import type { TestCase } from '@/lib/types';

export function buildGenerateTestsCritiquePrompt(
  parsed: ParsedSpec,
  tests: TestCase[],
): string {
  return `You are an evaluation engineer reviewing a generated test suite.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Tests JSON:
${JSON.stringify(tests)}

Evaluate the tests against this checklist. For every violation, emit one issue:
1. Count — exactly 20 tests with IDs test-01..test-20.
2. Distribution — roughly 8 happy_path, 7 edge_case, 5 adversarial (±1 each).
3. Concrete inputs — every input is a literal string the feature would receive, not a description, placeholder, or meta-language ("This test checks…").
4. Coverage of inputs — every parsed-spec input is exercised by ≥1 test.
5. Coverage of constraints — every parsed-spec constraint is probed by ≥1 test.
6. Adversarial validity — adversarial-labeled tests actually attempt to break the agent (prompt injection, jailbreak, contradictory instructions, hostile input, ambiguous phrasing) — not merely informal phrasing or typos.
7. Realism — inputs resemble real user phrasing; tone/length/register varies.
8. Specificity — no input so vague the agent's behavior can't be evaluated.

For each violation, emit an issue object:
{
  "field": "JSON path into the tests array, e.g. tests[3].category",
  "severity": "major" | "minor",
  "description": "what is wrong",
  "suggestion": "how to fix"
}

Use "major" only for issues that would invalidate the test as a unit of evaluation. Style nits are "minor".

Respond with ONLY this JSON (no prose, no markdown):
{ "issues": [ ... ] }

If everything is correct, respond with: { "issues": [] }`;
}

export function buildGenerateTestsRevisePrompt(
  current: TestCase[],
  issues: Issue[],
): string {
  return `You produced this test suite:
${JSON.stringify(current)}

A reviewer found these issues:
${renderIssues(issues)}

Produce a corrected test suite that:
1. Fixes EVERY listed issue.
2. Preserves all unflagged tests unchanged.
3. Returns the SAME schema shape: an array of 20 objects, each with id, category, input, and optional notes.
4. Keeps IDs zero-padded (test-01..test-20) and unique.
5. Each input must remain a literal string the feature would receive — never a description.

Respond with ONLY the corrected JSON array (no prose, no markdown).`;
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `npm run test:run -- src/lib/__tests__/prompts.test.ts`
Expected: PASS — all prompt tests including the 4 new.

- [ ] **Step 6.5: Run the full suite**

Run: `npm run test:run`
Expected: all green (84 + 4 new).

- [ ] **Step 6.6: Commit**

```bash
git add src/lib/prompts.ts src/lib/__tests__/prompts.test.ts
git commit -m "feat: add generate-tests critique and revise prompt builders"
```

---

## Task 7: Refactor `/api/generate-tests` to SSE (TDD)

**Files:**
- Modify: `src/app/api/generate-tests/route.ts`
- Modify: `src/app/api/generate-tests/__tests__/route.test.ts`

- [ ] **Step 7.1: Replace the route test file**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/generate-tests/route';
import { readSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, TestCase, RefinementEvent } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';

const sampleParsed: ParsedSpec = {
  feature: 'Extracts obligations.',
  inputs: ['contract pdf'],
  outputs: ['table'],
  constraints: ['due date'],
  domain: 'legal',
};

const sampleTests: TestCase[] = Array.from({ length: 20 }, (_, i) => ({
  id: `test-${String(i + 1).padStart(2, '0')}`,
  category: i < 8 ? 'happy_path' : i < 15 ? 'edge_case' : 'adversarial',
  input: `sample input ${i + 1}`,
}));

const cleanCritique = { issues: [] };

function jsonReq(body: unknown): Request {
  return new Request('http://test/api/generate-tests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(generateJSON).mockReset();
});

describe('POST /api/generate-tests (SSE)', () => {
  it('rejects non-JSON body with 400', async () => {
    const req = new Request('http://test/api/generate-tests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects body without parsed field with 400', async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(400);
  });

  it('streams a clean run when first critique returns no issues', async () => {
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleTests)
      .mockResolvedValueOnce(cleanCritique);
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = await readSSEStream<RefinementEvent<TestCase[]>>(res);
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'done',
    ]);
  });

  it('streams a revise round when first critique flags major issues', async () => {
    const issue = {
      field: 'tests[10].category',
      severity: 'major' as const,
      description: 'mislabeled',
      suggestion: 'fix',
    };
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleTests)
      .mockResolvedValueOnce({ issues: [issue] })
      .mockResolvedValueOnce(sampleTests)
      .mockResolvedValueOnce(cleanCritique);
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    const events = await readSSEStream<RefinementEvent<TestCase[]>>(res);
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'revising',
      'revised',
      'critiquing',
      'critiqued',
      'done',
    ]);
  });

  it('emits error when generate throws', async () => {
    vi.mocked(generateJSON).mockRejectedValueOnce(new Error('gemini fail'));
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    const events = await readSSEStream<RefinementEvent<TestCase[]>>(res);
    expect(events.map((e) => e.type)).toEqual(['error']);
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `npm run test:run -- src/app/api/generate-tests`
Expected: FAIL.

- [ ] **Step 7.3: Replace `src/app/api/generate-tests/route.ts`**

```ts
import { generateJSON } from '@/lib/gemini';
import {
  buildGenerateTestsPrompt,
  buildGenerateTestsCritiquePrompt,
  buildGenerateTestsRevisePrompt,
} from '@/lib/prompts';
import { runRefinement } from '@/lib/refinement';
import type {
  Issue,
  ParsedSpec,
  RefinementEvent,
  TestCase,
} from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

function frame(event: RefinementEvent<TestCase[]>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function isParsedSpec(v: unknown): v is ParsedSpec {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<ParsedSpec>;
  return (
    typeof p.feature === 'string' &&
    Array.isArray(p.inputs) &&
    Array.isArray(p.outputs) &&
    Array.isArray(p.constraints) &&
    typeof p.domain === 'string'
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = (body as { parsed?: unknown }).parsed;
  if (!isParsedSpec(parsed)) {
    return Response.json(
      { error: 'parsed must be a ParsedSpec object.' },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const generator = runRefinement<TestCase[]>({
        generate: async () => {
          const result = await generateJSON<TestCase[] | { tests: TestCase[] }>(
            buildGenerateTestsPrompt(parsed),
          );
          // The existing prompt instructs the model to return an array.
          // Tolerate { tests: [...] } for backward compatibility.
          return Array.isArray(result) ? result : result.tests;
        },
        critique: async (current) => {
          const result = await generateJSON<{ issues: Issue[] }>(
            buildGenerateTestsCritiquePrompt(parsed, current),
          );
          return Array.isArray(result?.issues) ? result.issues : [];
        },
        revise: async (current, issues) => {
          const result = await generateJSON<TestCase[] | { tests: TestCase[] }>(
            buildGenerateTestsRevisePrompt(current, issues),
          );
          return Array.isArray(result) ? result : result.tests;
        },
        signal: req.signal,
      });
      try {
        for await (const evt of generator) {
          controller.enqueue(encoder.encode(frame(evt)));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
```

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `npm run test:run -- src/app/api/generate-tests`
Expected: PASS — 5/5.

- [ ] **Step 7.5: Run the full suite**

Run: `npm run test:run`
Expected: all green.

- [ ] **Step 7.6: Commit**

```bash
git add src/app/api/generate-tests/route.ts src/app/api/generate-tests/__tests__/route.test.ts
git commit -m "feat: refactor /api/generate-tests to SSE with refinement loop"
```

---

## Task 8: Generate-rubric critique + revise prompt builders (TDD)

**Files:**
- Modify: `src/lib/prompts.ts`
- Modify: `src/lib/__tests__/prompts.test.ts`

- [ ] **Step 8.1: Append failing tests**

```ts
import {
  buildGenerateRubricCritiquePrompt,
  buildGenerateRubricRevisePrompt,
} from '@/lib/prompts';
import type { Rubric } from '@/lib/types';

const sampleRubric: Rubric = {
  dimensions: [
    { id: 'a', label: 'A', description: 'desc', weight: 0.25 },
    { id: 'b', label: 'B', description: 'desc', weight: 0.25 },
    { id: 'c', label: 'C', description: 'desc', weight: 0.25 },
    { id: 'd', label: 'D', description: 'desc', weight: 0.25 },
  ],
};

describe('buildGenerateRubricCritiquePrompt', () => {
  it('embeds the parsed spec and rubric JSON', () => {
    const prompt = buildGenerateRubricCritiquePrompt(sampleParsed, sampleRubric);
    expect(prompt).toContain(sampleParsed.feature);
    expect(prompt).toContain(JSON.stringify(sampleRubric));
  });

  it('includes every checklist item from the spec', () => {
    const prompt = buildGenerateRubricCritiquePrompt(sampleParsed, sampleRubric);
    for (const cue of [
      'dimension count',
      'weights',
      'kebab-case',
      'independence',
      'measurability',
      'coverage',
      'domain specificity',
      'naming',
    ]) {
      expect(prompt.toLowerCase()).toContain(cue);
    }
  });
});

describe('buildGenerateRubricRevisePrompt', () => {
  it('embeds the current rubric and renders each issue as a bullet', () => {
    const issue: Issue = {
      field: 'dimensions[0].weight',
      severity: 'major',
      description: 'weights do not sum to 1',
      suggestion: 'rebalance',
    };
    const prompt = buildGenerateRubricRevisePrompt(sampleRubric, [issue]);
    expect(prompt).toContain(JSON.stringify(sampleRubric));
    expect(prompt).toContain(issue.field);
    expect(prompt).toContain(issue.suggestion);
    expect(prompt).toMatch(/preserve/i);
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 8.3: Append builders to `src/lib/prompts.ts`**

```ts
import type { Rubric } from '@/lib/types';

export function buildGenerateRubricCritiquePrompt(
  parsed: ParsedSpec,
  rubric: Rubric,
): string {
  return `You are an evaluation engineer reviewing a scoring rubric.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Rubric JSON:
${JSON.stringify(rubric)}

Evaluate the rubric against this checklist. For every violation, emit one issue:
1. Dimension count — between 4 and 6 dimensions.
2. Weights — every weight is in [0, 1] and the weights sum to 1.0 within ±0.01.
3. ID format — every id is kebab-case (e.g. factual-accuracy).
4. Independence — dimensions don't overlap; no two score the same thing.
5. Measurability — each description provides scorable criteria, not opinion.
6. Coverage — every parsed-spec constraint is reflected in at least one dimension.
7. Domain specificity — no generic dimensions like "quality" or "helpfulness"; each reflects a real failure mode for THIS feature.
8. Naming clarity — labels are self-explanatory.

For each violation, emit an issue object:
{
  "field": "JSON path, e.g. dimensions[0].weight",
  "severity": "major" | "minor",
  "description": "what is wrong",
  "suggestion": "how to fix"
}

Use "major" for anything that would invalidate scoring (count, weights, coverage). Style nits are "minor".

Respond with ONLY this JSON (no prose, no markdown):
{ "issues": [ ... ] }

If everything is correct, respond with: { "issues": [] }`;
}

export function buildGenerateRubricRevisePrompt(
  current: Rubric,
  issues: Issue[],
): string {
  return `You produced this rubric:
${JSON.stringify(current)}

A reviewer found these issues:
${renderIssues(issues)}

Produce a corrected rubric that:
1. Fixes EVERY listed issue.
2. Preserves all unflagged dimensions unchanged.
3. Returns the SAME schema: { "dimensions": [{ id, label, description, weight }, ...] }.
4. Keeps 4-6 dimensions; ids stay kebab-case; weights are floats in [0, 1] summing to 1.0 within ±0.01.

Respond with ONLY the corrected JSON object (no prose, no markdown).`;
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `npm run test:run -- src/lib/__tests__/prompts.test.ts`
Expected: PASS.

- [ ] **Step 8.5: Run the full suite**

Run: `npm run test:run`
Expected: all green.

- [ ] **Step 8.6: Commit**

```bash
git add src/lib/prompts.ts src/lib/__tests__/prompts.test.ts
git commit -m "feat: add generate-rubric critique and revise prompt builders"
```

---

## Task 9: Refactor `/api/generate-rubric` to SSE (TDD)

**Files:**
- Modify: `src/app/api/generate-rubric/route.ts`
- Modify: `src/app/api/generate-rubric/__tests__/route.test.ts`

- [ ] **Step 9.1: Replace the route test file**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/generate-rubric/route';
import { readSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, Rubric, RefinementEvent } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';

const sampleParsed: ParsedSpec = {
  feature: 'Extracts obligations.',
  inputs: ['contract pdf'],
  outputs: ['table'],
  constraints: ['due date'],
  domain: 'legal',
};

const sampleRubric: Rubric = {
  dimensions: [
    { id: 'a', label: 'A', description: 'd', weight: 0.25 },
    { id: 'b', label: 'B', description: 'd', weight: 0.25 },
    { id: 'c', label: 'C', description: 'd', weight: 0.25 },
    { id: 'd', label: 'D', description: 'd', weight: 0.25 },
  ],
};

const cleanCritique = { issues: [] };

function jsonReq(body: unknown): Request {
  return new Request('http://test/api/generate-rubric', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(generateJSON).mockReset();
});

describe('POST /api/generate-rubric (SSE)', () => {
  it('rejects non-JSON body with 400', async () => {
    const req = new Request('http://test/api/generate-rubric', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects body without parsed with 400', async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(400);
  });

  it('streams a clean run when first critique is empty', async () => {
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleRubric)
      .mockResolvedValueOnce(cleanCritique);
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = await readSSEStream<RefinementEvent<Rubric>>(res);
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'done',
    ]);
  });

  it('streams a revise round when critique flags majors', async () => {
    const issue = {
      field: 'dimensions[0].weight',
      severity: 'major' as const,
      description: 'sum',
      suggestion: 'rebalance',
    };
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleRubric)
      .mockResolvedValueOnce({ issues: [issue] })
      .mockResolvedValueOnce(sampleRubric)
      .mockResolvedValueOnce(cleanCritique);
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    const events = await readSSEStream<RefinementEvent<Rubric>>(res);
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'revising',
      'revised',
      'critiquing',
      'critiqued',
      'done',
    ]);
  });

  it('emits error when generate throws', async () => {
    vi.mocked(generateJSON).mockRejectedValueOnce(new Error('boom'));
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    const events = await readSSEStream<RefinementEvent<Rubric>>(res);
    expect(events.map((e) => e.type)).toEqual(['error']);
  });
});
```

- [ ] **Step 9.2: Run tests to verify they fail**

Run: `npm run test:run -- src/app/api/generate-rubric`
Expected: FAIL.

- [ ] **Step 9.3: Replace `src/app/api/generate-rubric/route.ts`**

```ts
import { generateJSON } from '@/lib/gemini';
import {
  buildGenerateRubricPrompt,
  buildGenerateRubricCritiquePrompt,
  buildGenerateRubricRevisePrompt,
} from '@/lib/prompts';
import { runRefinement } from '@/lib/refinement';
import type {
  Issue,
  ParsedSpec,
  RefinementEvent,
  Rubric,
} from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

function frame(event: RefinementEvent<Rubric>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function isParsedSpec(v: unknown): v is ParsedSpec {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<ParsedSpec>;
  return (
    typeof p.feature === 'string' &&
    Array.isArray(p.inputs) &&
    Array.isArray(p.outputs) &&
    Array.isArray(p.constraints) &&
    typeof p.domain === 'string'
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = (body as { parsed?: unknown }).parsed;
  if (!isParsedSpec(parsed)) {
    return Response.json(
      { error: 'parsed must be a ParsedSpec object.' },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const generator = runRefinement<Rubric>({
        generate: () => generateJSON<Rubric>(buildGenerateRubricPrompt(parsed)),
        critique: async (current) => {
          const result = await generateJSON<{ issues: Issue[] }>(
            buildGenerateRubricCritiquePrompt(parsed, current),
          );
          return Array.isArray(result?.issues) ? result.issues : [];
        },
        revise: (current, issues) =>
          generateJSON<Rubric>(buildGenerateRubricRevisePrompt(current, issues)),
        signal: req.signal,
      });
      try {
        for await (const evt of generator) {
          controller.enqueue(encoder.encode(frame(evt)));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
```

- [ ] **Step 9.4: Run tests to verify they pass**

Run: `npm run test:run -- src/app/api/generate-rubric`
Expected: PASS — 5/5.

- [ ] **Step 9.5: Run the full suite**

Run: `npm run test:run`
Expected: all green.

- [ ] **Step 9.6: Commit**

```bash
git add src/app/api/generate-rubric/route.ts src/app/api/generate-rubric/__tests__/route.test.ts
git commit -m "feat: refactor /api/generate-rubric to SSE with refinement loop"
```

---

## Task 10: Rewrite `pageReducer` for stage-based state machine (TDD)

**Files:**
- Modify: `src/lib/pageReducer.ts`
- Modify: `src/lib/__tests__/pageReducer.test.ts`

The reducer's shape changes completely. The old `PageStatus` enum is replaced by per-stage `StageState`. Tests must be rewritten before the implementation.

- [ ] **Step 10.1: Replace `src/lib/__tests__/pageReducer.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { initialState, reducer } from '@/lib/pageReducer';
import type {
  Issue,
  ParsedSpec,
  Rubric,
  TestCase,
} from '@/lib/types';

const sampleParsed: ParsedSpec = {
  feature: 'F',
  inputs: ['i'],
  outputs: ['o'],
  constraints: ['c'],
  domain: 'general',
};

const sampleTests: TestCase[] = [
  { id: 'test-01', category: 'happy_path', input: 'x' },
];

const sampleRubric: Rubric = {
  dimensions: [{ id: 'a', label: 'A', description: 'd', weight: 1 }],
};

const majorIssue: Issue = {
  field: 'feature',
  severity: 'major',
  description: 'fix',
  suggestion: 'fix it',
};

describe('pageReducer', () => {
  it('starts in idle for every stage', () => {
    expect(initialState.stages.parse.phase).toBe('idle');
    expect(initialState.stages.tests.phase).toBe('idle');
    expect(initialState.stages.rubric.phase).toBe('idle');
    expect(initialState.error).toBeNull();
  });

  it('STAGE_START sets the named stage to generating with pass=0 and clears prior data', () => {
    const seed = reducer(initialState, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'done', output: sampleParsed },
    });
    const next = reducer(seed, { type: 'STAGE_START', stage: 'parse' });
    expect(next.stages.parse.phase).toBe('generating');
    expect(next.stages.parse.pass).toBe(0);
    expect(next.stages.parse.current).toBeNull();
    expect(next.stages.parse.issues).toEqual([]);
  });

  it('generated event stores current output and keeps phase as generating', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'generated', pass: 0, output: sampleParsed },
    });
    expect(next.stages.parse.phase).toBe('generating');
    expect(next.stages.parse.current).toEqual(sampleParsed);
    expect(next.stages.parse.pass).toBe(0);
  });

  it('critiquing event flips phase to critiquing and updates pass', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'critiquing', pass: 1 },
    });
    expect(next.stages.parse.phase).toBe('critiquing');
    expect(next.stages.parse.pass).toBe(1);
  });

  it('critiqued event stores issues; phase stays critiquing if any major issues', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'critiqued', pass: 1, issues: [majorIssue] },
    });
    expect(next.stages.parse.phase).toBe('critiquing');
    expect(next.stages.parse.issues).toEqual([majorIssue]);
  });

  it('critiqued event with no major issues moves phase to done-pending', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'critiqued', pass: 1, issues: [] },
    });
    expect(next.stages.parse.phase).toBe('done');
  });

  it('revising event flips phase to revising', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'tests' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'tests',
      event: { type: 'revising', pass: 1 },
    });
    expect(next.stages.tests.phase).toBe('revising');
    expect(next.stages.tests.pass).toBe(1);
  });

  it('revised event updates current output and pass; phase stays revising', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'tests' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'tests',
      event: { type: 'revised', pass: 1, output: sampleTests },
    });
    expect(next.stages.tests.current).toEqual(sampleTests);
    expect(next.stages.tests.pass).toBe(1);
    expect(next.stages.tests.phase).toBe('revising');
  });

  it('done event locks the stage with the final output', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'rubric' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'rubric',
      event: { type: 'done', output: sampleRubric },
    });
    expect(next.stages.rubric.phase).toBe('done');
    expect(next.stages.rubric.current).toEqual(sampleRubric);
  });

  it('error event flips phase to error and sets root error', () => {
    const next = reducer(initialState, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'error', message: 'boom' },
    });
    expect(next.stages.parse.phase).toBe('error');
    expect(next.error).toEqual({ stage: 'parse', message: 'boom', recoverable: false });
  });

  it('STAGE_ERR sets root error and stage phase to error', () => {
    const next = reducer(initialState, {
      type: 'STAGE_ERR',
      stage: 'tests',
      message: 'network',
      recoverable: true,
    });
    expect(next.stages.tests.phase).toBe('error');
    expect(next.error).toEqual({ stage: 'tests', message: 'network', recoverable: true });
  });

  it('RESET returns initial state', () => {
    const dirty = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    expect(reducer(dirty, { type: 'RESET' })).toEqual(initialState);
  });
});
```

- [ ] **Step 10.2: Run tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/pageReducer.test.ts`
Expected: FAIL — old reducer doesn't have these actions or state shape.

- [ ] **Step 10.3: Replace `src/lib/pageReducer.ts`**

```ts
import type {
  Issue,
  ParsedSpec,
  RefinementEvent,
  Rubric,
  TestCase,
} from '@/lib/types';

export type StagePhase =
  | 'idle'
  | 'generating'
  | 'critiquing'
  | 'revising'
  | 'done'
  | 'error';

export type StageState<T> = {
  phase: StagePhase;
  pass: 0 | 1 | 2;
  current: T | null;
  issues: Issue[];
};

export type StageKey = 'parse' | 'tests' | 'rubric';

export type PageState = {
  spec: string;
  stages: {
    parse: StageState<ParsedSpec>;
    tests: StageState<TestCase[]>;
    rubric: StageState<Rubric>;
  };
  error: { stage: StageKey; message: string; recoverable: boolean } | null;
};

export type PageAction =
  | { type: 'STAGE_START'; stage: StageKey }
  | { type: 'STAGE_EVENT'; stage: StageKey; event: RefinementEvent<unknown> }
  | { type: 'STAGE_ERR'; stage: StageKey; message: string; recoverable: boolean }
  | { type: 'PIPELINE_START'; spec: string }
  | { type: 'RESET' };

const idleStage = <T>(): StageState<T> => ({
  phase: 'idle',
  pass: 0,
  current: null,
  issues: [],
});

export const initialState: PageState = {
  spec: '',
  stages: {
    parse: idleStage<ParsedSpec>(),
    tests: idleStage<TestCase[]>(),
    rubric: idleStage<Rubric>(),
  },
  error: null,
};

function applyEvent<T>(stage: StageState<T>, event: RefinementEvent<T>): StageState<T> {
  switch (event.type) {
    case 'generated':
      return { ...stage, current: event.output, pass: 0 };
    case 'critiquing':
      return { ...stage, phase: 'critiquing', pass: event.pass };
    case 'critiqued': {
      const major = event.issues.filter((i) => i.severity === 'major');
      return {
        ...stage,
        issues: event.issues,
        phase: major.length === 0 ? 'done' : 'critiquing',
      };
    }
    case 'revising':
      return { ...stage, phase: 'revising', pass: event.pass };
    case 'revised':
      return { ...stage, current: event.output, pass: event.pass };
    case 'done':
      return { ...stage, phase: 'done', current: event.output };
    case 'error':
      return { ...stage, phase: 'error' };
  }
}

export function reducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case 'PIPELINE_START':
      return { ...initialState, spec: action.spec };
    case 'STAGE_START': {
      const reset = idleStage();
      return {
        ...state,
        stages: {
          ...state.stages,
          [action.stage]: { ...reset, phase: 'generating' },
        },
        error: null,
      };
    }
    case 'STAGE_EVENT': {
      const current = state.stages[action.stage];
      // Type narrowing: each stage holds a different T, but the reducer
      // treats output opaquely. Cast at the boundary.
      const updated = applyEvent(current as StageState<unknown>, action.event);
      const next: PageState = {
        ...state,
        stages: { ...state.stages, [action.stage]: updated },
      };
      if (action.event.type === 'error') {
        next.error = {
          stage: action.stage,
          message: action.event.message,
          recoverable: false,
        };
      }
      return next;
    }
    case 'STAGE_ERR': {
      const current = state.stages[action.stage];
      return {
        ...state,
        stages: {
          ...state.stages,
          [action.stage]: { ...current, phase: 'error' },
        },
        error: {
          stage: action.stage,
          message: action.message,
          recoverable: action.recoverable,
        },
      };
    }
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}
```

- [ ] **Step 10.4: Run tests to verify they pass**

Run: `npm run test:run -- src/lib/__tests__/pageReducer.test.ts`
Expected: PASS — 12/12.

- [ ] **Step 10.5: Run the full suite**

Run: `npm run test:run`
Expected: most green; `page.tsx` will fail typecheck because it still uses the old reducer shape. That gets fixed in Task 11.

If `page.tsx` causes test compilation failures, this is expected — proceed to Task 11. If actual test logic fails, stop and debug.

- [ ] **Step 10.6: Commit**

```bash
git add src/lib/pageReducer.ts src/lib/__tests__/pageReducer.test.ts
git commit -m "feat: rewrite pageReducer for per-stage state machine"
```

---

## Task 11: Rewrite `page.tsx` to consume SSE per stage (TDD)

**Files:**
- Create: `src/app/__tests__/page.test.tsx`
- Modify: `src/app/page.tsx`

The page now:
- Opens 3 sequential SSE connections.
- Dispatches every received frame as a `STAGE_EVENT`.
- Computes status text from reducer state.
- Re-renders intermediate `current` outputs on each `revised` event.

- [ ] **Step 11.1: Create `src/app/__tests__/page.test.tsx` (failing tests)**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Home from '@/app/page';
import { mockSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

const sampleParsed: ParsedSpec = {
  feature: 'Extracts obligations.',
  inputs: ['contract pdf'],
  outputs: ['table'],
  constraints: ['due date'],
  domain: 'legal',
};

const sampleTests: TestCase[] = Array.from({ length: 20 }, (_, i) => ({
  id: `test-${String(i + 1).padStart(2, '0')}`,
  category: i < 8 ? 'happy_path' : i < 15 ? 'edge_case' : 'adversarial',
  input: `input ${i + 1}`,
}));

const sampleRubric: Rubric = {
  dimensions: [
    { id: 'a', label: 'A', description: 'd', weight: 0.5 },
    { id: 'b', label: 'B', description: 'd', weight: 0.5 },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetchSequence(streams: Response[]) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = streams[i++];
      if (!next) throw new Error('unexpected fetch call');
      return next;
    }),
  );
}

describe('Home page (SSE pipeline)', () => {
  it('renders the spec form on mount', () => {
    render(<Home />);
    expect(screen.getByPlaceholderText(/spec/i)).toBeInTheDocument();
  });

  it('runs all three stages end-to-end and shows the final UI', async () => {
    mockFetchSequence([
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleParsed },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleParsed },
      ]),
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleTests },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleTests },
      ]),
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleRubric },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleRubric },
      ]),
    ]);
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/spec/i), {
      target: { value: 'AI extracts obligations.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText(/Plan C wires the runner/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Test suite \(20\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Rubric/i)).toBeInTheDocument();
  });

  it('shows critiquing pass counter in the status text', async () => {
    mockFetchSequence([
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleParsed },
        { type: 'critiquing', pass: 1 },
        // hold here so we can assert mid-run
      ]),
    ]);
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/spec/i), {
      target: { value: 'spec' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText(/Critiquing parsed spec \(pass 1\/2\)/i)).toBeInTheDocument(),
    );
  });

  it('renders an error message when a stage emits an error event', async () => {
    mockFetchSequence([
      mockSSEStream([{ type: 'error', message: 'gemini down' }]),
    ]);
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/spec/i), {
      target: { value: 'spec' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText(/gemini down/i)).toBeInTheDocument(),
    );
  });

  it('updates the test table live when a revised event arrives', async () => {
    const v0 = sampleTests.map((t, i) => (i === 0 ? { ...t, input: 'OLD' } : t));
    const v1 = sampleTests.map((t, i) => (i === 0 ? { ...t, input: 'NEW' } : t));
    mockFetchSequence([
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleParsed },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleParsed },
      ]),
      mockSSEStream([
        { type: 'generated', pass: 0, output: v0 },
        { type: 'critiquing', pass: 1 },
        {
          type: 'critiqued',
          pass: 1,
          issues: [
            {
              field: 'tests[0].input',
              severity: 'major',
              description: 'too vague',
              suggestion: 'be specific',
            },
          ],
        },
        { type: 'revising', pass: 1 },
        { type: 'revised', pass: 1, output: v1 },
        { type: 'critiquing', pass: 2 },
        { type: 'critiqued', pass: 2, issues: [] },
        { type: 'done', output: v1 },
      ]),
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleRubric },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleRubric },
      ]),
    ]);
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/spec/i), {
      target: { value: 'spec' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText(/Plan C wires the runner/i)).toBeInTheDocument(),
    );
    expect(screen.getByText('NEW')).toBeInTheDocument();
    expect(screen.queryByText('OLD')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 11.2: Run tests to verify they fail**

Run: `npm run test:run -- src/app/__tests__/page.test.tsx`
Expected: FAIL — page still uses old `postJSON` and old reducer.

- [ ] **Step 11.3: Replace `src/app/page.tsx`**

```tsx
'use client';

import { useReducer } from 'react';
import SpecForm from '@/components/SpecForm';
import DomainBadge from '@/components/DomainBadge';
import TestSuiteTable from '@/components/TestSuiteTable';
import RubricPanel from '@/components/RubricPanel';
import { initialState, reducer } from '@/lib/pageReducer';
import type { StageKey, StageState } from '@/lib/pageReducer';
import type {
  ParsedSpec,
  RefinementEvent,
  Rubric,
  TestCase,
} from '@/lib/types';

const STAGE_LABEL: Record<StageKey, string> = {
  parse: 'parsed spec',
  tests: 'tests',
  rubric: 'rubric',
};

function statusText<T>(stage: StageKey, state: StageState<T>): string | null {
  if (state.phase === 'idle') return null;
  if (state.phase === 'done') return null;
  if (state.phase === 'error') return null;
  const label = STAGE_LABEL[stage];
  if (state.phase === 'generating') return `Generating ${label}…`;
  if (state.phase === 'critiquing')
    return `Critiquing ${label} (pass ${Math.max(state.pass, 1)}/2)…`;
  if (state.phase === 'revising')
    return `Revising ${label} (pass ${state.pass}/2)…`;
  return null;
}

// Parses an SSE response body and dispatches one event per `data:` frame.
// Resolves with the final `done` event's payload when the stream closes.
async function runStage<T>(
  url: string,
  body: unknown,
  stage: StageKey,
  dispatch: (action: {
    type: 'STAGE_EVENT';
    stage: StageKey;
    event: RefinementEvent<T>;
  }) => void,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (!res.body) throw new Error('Empty response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let final: T | null = null;
  let errored: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as RefinementEvent<T>;
      dispatch({ type: 'STAGE_EVENT', stage, event });
      if (event.type === 'done') final = event.output;
      if (event.type === 'error') errored = event.message;
    }
  }
  if (errored) throw new Error(errored);
  if (final === null) throw new Error('Stream closed without done event');
  return final;
}

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);

  async function run(spec: string) {
    dispatch({ type: 'PIPELINE_START', spec });
    try {
      dispatch({ type: 'STAGE_START', stage: 'parse' });
      const parsed = await runStage<ParsedSpec>(
        '/api/parse-spec',
        { spec },
        'parse',
        dispatch,
      );
      dispatch({ type: 'STAGE_START', stage: 'tests' });
      await runStage<TestCase[]>(
        '/api/generate-tests',
        { parsed },
        'tests',
        dispatch,
      );
      dispatch({ type: 'STAGE_START', stage: 'rubric' });
      await runStage<Rubric>(
        '/api/generate-rubric',
        { parsed },
        'rubric',
        dispatch,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      const stage: StageKey =
        state.stages.rubric.phase !== 'idle'
          ? 'rubric'
          : state.stages.tests.phase !== 'idle'
            ? 'tests'
            : 'parse';
      dispatch({ type: 'STAGE_ERR', stage, message, recoverable: true });
    }
  }

  const parsed = state.stages.parse.current;
  const tests = state.stages.tests.current;
  const rubric = state.stages.rubric.current;
  const ready =
    state.stages.parse.phase === 'done' &&
    state.stages.tests.phase === 'done' &&
    state.stages.rubric.phase === 'done';

  const parseStatus = statusText('parse', state.stages.parse);
  const testsStatus = statusText('tests', state.stages.tests);
  const rubricStatus = statusText('rubric', state.stages.rubric);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-4xl text-fg">EvalForge</h1>
        <p className="font-body text-base text-muted max-w-2xl">
          Paste an AI feature spec. Get a domain-aware eval suite that runs.
        </p>
      </header>

      <SpecForm onSubmit={run} />

      {parseStatus && (
        <p className="font-mono text-xs text-muted">{parseStatus}</p>
      )}

      {parsed && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl text-fg">Parsed spec</h2>
            <DomainBadge domain={parsed.domain} />
          </div>
          <div className="rounded-md border border-border bg-surface p-4 font-mono text-xs text-muted whitespace-pre-wrap">
            {JSON.stringify(parsed, null, 2)}
          </div>
        </section>
      )}

      {testsStatus && (
        <p className="font-mono text-xs text-muted">{testsStatus}</p>
      )}

      {tests && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-fg">
            Test suite ({tests.length})
          </h2>
          <TestSuiteTable tests={tests} />
        </section>
      )}

      {rubricStatus && (
        <p className="font-mono text-xs text-muted">{rubricStatus}</p>
      )}

      {rubric && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-fg">Rubric</h2>
          <RubricPanel rubric={rubric} />
        </section>
      )}

      {ready && (
        <p className="font-mono text-xs text-success">
          Ready. Plan C wires the runner.
        </p>
      )}

      {state.error && (
        <p className="font-mono text-xs text-failure">
          Error: {state.error.message}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 11.4: Run page tests**

Run: `npm run test:run -- src/app/__tests__/page.test.tsx`
Expected: PASS — 5/5.

- [ ] **Step 11.5: Run the full suite**

Run: `npm run test:run`
Expected: all green. New total approximately 110+ tests.

- [ ] **Step 11.6: Lint + build**

```bash
npm run lint
npm run build
```

Both clean.

- [ ] **Step 11.7: Commit**

```bash
git add src/app/page.tsx src/app/__tests__/page.test.tsx
git commit -m "feat: wire SSE stage consumer and per-stage status into page"
```

---

## Task 12: Manual smoke test + final verification

**Files:** None (verification only).

This task gates the plan. Each example chip must produce parsed spec → 20-row test table → 4-6 dim rubric, with visible refinement status text mid-run.

- [ ] **Step 12.1: Confirm `.env.local` has a real key**

```bash
cat .env.local 2>/dev/null | grep GEMINI_API_KEY
```

If missing, copy `.env.local.example` → `.env.local` and fill in `GEMINI_API_KEY=...`.

- [ ] **Step 12.2: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 12.3: For each chip (Legal, Sales, Healthcare):**

1. Click the chip; the textarea fills.
2. Click **Generate Eval Suite**.
3. Observe in order:
   - "Generating parsed spec…"
   - "Critiquing parsed spec (pass 1/2)…" (and possibly "Revising…", "Critiquing… (pass 2/2)").
   - Parsed-spec card appears with the expected `domain`.
   - "Generating tests…" → "Critiquing tests (pass 1/2)…" → 20-row table appears.
   - If a `revised` event fires, the table is observed to update in place.
   - "Generating rubric…" → "Critiquing rubric (pass 1/2)…" → rubric appears.
   - "Ready. Plan C wires the runner."
4. DevTools → Network tab: confirm three SSE responses (status 200, content-type `text/event-stream`).
5. DevTools → Server logs (or `vercel logs` locally — the dev terminal): confirm `refinement.complete` JSON entries (added in a future telemetry pass; warning OK if missing here — telemetry is out of scope for v1 implementation but checked at smoke-test time).

Record any failures. Iterate on prompts only if necessary; commit prompt tweaks separately.

- [ ] **Step 12.4: Stop the dev server**

Ctrl-C in the terminal.

- [ ] **Step 12.5: Re-run the full test suite**

```bash
npm run test:run
```

Expected: all green.

- [ ] **Step 12.6: Run lint + build**

```bash
npm run lint
npm run build
```

Both clean.

- [ ] **Step 12.7: Optional — commit any prompt tweaks**

If any prompt was edited during smoke testing:

```bash
git add src/lib/prompts.ts
git commit -m "chore: tune refinement prompts based on smoke test feedback"
```

---

## Done-When checklist

- [ ] All 3 routes return SSE streams emitting the documented event schema.
- [ ] `lib/refinement.ts` exists, is unit-tested, and is consumed by all 3 routes.
- [ ] All 9 prompt builders exist in `lib/prompts.ts` with assertion tests.
- [ ] `pageReducer` handles `STAGE_START`, `STAGE_EVENT`, `STAGE_ERR`, `PIPELINE_START`, `RESET`.
- [ ] `TestSuiteTable` and `RubricPanel` re-render live as `revised` events arrive (verified by integration test).
- [ ] Status text shows the granular phase + pass counter.
- [ ] `npm run test:run` exits 0 with all tests passing (~110+).
- [ ] `npm run lint` reports no errors.
- [ ] `npm run build` completes without errors.
- [ ] Manual smoke: all three example chips render the loop UI and produce visibly higher-quality output than the `main` baseline.
- [ ] All commits use Conventional Commits.

When green, hand off to **Sub-project 2 (Exemplar library + retrieval)**.
