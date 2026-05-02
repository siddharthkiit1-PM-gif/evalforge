# EvalForge Plan B — Generation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire spec → parsed spec → test suite → rubric using three Gemini-backed POST routes, surface results through a state machine, and render `DomainBadge`, `TestSuiteTable`, and `RubricPanel`.

**Architecture:** Three POST route handlers (`parse-spec`, `generate-tests`, `generate-rubric`) each call a thin `lib/gemini.ts` wrapper that adds retry-on-429 and tolerant JSON extraction. `lib/prompts.ts` exports template functions for the three prompts. `src/app/page.tsx` becomes a `useReducer` state machine that orchestrates the three calls in sequence. All component tests mock `lib/gemini`; route tests mock `lib/gemini`; page tests mock `global.fetch`. No real Gemini calls in CI.

**Tech Stack:** Next.js 16.2.4 App Router POST routes, `@google/genai` 1.51.0, Tailwind v4 tokens, Vitest + RTL + jsdom, `useReducer` + `fetch` on the client.

**Reference docs to consult before writing code:**
- `node_modules/@google/genai/README.md` — verify the SDK call shape (`new GoogleGenAI({ apiKey })`, `ai.models.generateContent({ model, contents })`, response text accessor).
- `node_modules/next/dist/docs/01-app/02-guides/route-handlers.mdx` (or the index in `node_modules/next/dist/docs/01-app/`) — verify Next.js 16 route handler conventions (`export const runtime`, `Request` parameter shape, `Response.json` helpers).
- `docs/superpowers/specs/2026-05-02-evalforge-design.md` — the canonical scope reference.

**Tested model id:** `gemini-2.5-flash`. If the SDK rejects this id at smoke-test time, swap the constant in `lib/gemini.ts` only.

---

## Pre-flight

Before starting Task 1, verify the working tree is clean and you are on a fresh feature branch:

```bash
git status                              # expect: clean, on main
git checkout -b feat/plan-b-generation
```

Confirm the foundation is intact:

```bash
npm run test:run                        # 16 passing (sanity 1 + Nav 3 + Footer 2 + SpecInput 4 + SpecForm 6)
npm run build                           # clean, 4 static routes
```

If either fails, stop and report — Plan A regressed.

---

## Task 1: Types module

**Files:**
- Create: `src/lib/types.ts`

This is a pure types file. No test (Plan A established the convention that data-only modules don't need a test).

- [ ] **Step 1.1: Create `src/lib/types.ts`**

```ts
// Domains EvalForge is tuned for. 'general' is the fallback when none of the
// three flagship domains is detected.
export type Domain = 'legal' | 'sales' | 'healthcare' | 'general';

// What the parse-spec call extracts from a free-form feature spec.
export type ParsedSpec = {
  feature: string;          // 1-line summary of the feature
  inputs: string[];         // what the AI receives, one bullet per item
  outputs: string[];        // what the AI produces
  constraints: string[];    // requirements the output must satisfy
  domain: Domain;
};

// One generated test case. The eval runner (Plan C) feeds `input` to the
// feature-as-Gemini and judges the response against the rubric.
export type TestCase = {
  id: string;               // 'test-01' .. 'test-20'
  category: 'happy_path' | 'edge_case' | 'adversarial';
  input: string;
  notes?: string;           // optional, why this test exists
};

// One scoring dimension on the rubric.
export type RubricDimension = {
  id: string;               // kebab-case, e.g. 'factual-accuracy'
  label: string;            // human-readable
  description: string;      // 1-2 sentences explaining the dimension
  weight: number;           // 0-1, dimensions sum to 1.0 within ±0.01
};

export type Rubric = {
  dimensions: RubricDimension[];
};

// Reserved for Plan C — kept here so the state machine can reference them.
export type EvalScore = {
  dimensionId: string;
  score: number;            // 0-1
  reasoning: string;
};

export type EvalResult = {
  testId: string;
  output: string;
  scores: EvalScore[];
  passed: boolean;
};
```

- [ ] **Step 1.2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 1.3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add core types for parsed spec, tests, and rubric"
```

---

## Task 2: Gemini client wrapper (TDD)

**Files:**
- Create: `src/lib/gemini.ts`
- Create: `src/lib/__tests__/gemini.test.ts`

`gemini.ts` is the only module that talks to `@google/genai`. It exports:
- `MODEL_ID` constant (`'gemini-2.5-flash'`).
- `extractJSON<T>(text: string): T` — strips ```json``` code fences and parses. Throws if the result isn't valid JSON.
- `withRetry<T>(fn: () => Promise<T>, opts?): Promise<T>` — exponential backoff on `status === 429` errors. Default: 3 attempts at 10s, 20s, 40s.
- `generateJSON<T>(prompt: string): Promise<T>` — calls Gemini once, runs `extractJSON`, returns parsed result. Wraps `withRetry`.

`runBatched` is deferred to Plan C.

- [ ] **Step 2.1: Read the SDK README**

Run: `cat node_modules/@google/genai/README.md | head -120`. Confirm:
- The default export or named export creates a client (`new GoogleGenAI({ apiKey })` or similar).
- The text-generation method (likely `client.models.generateContent({ model, contents })` or `client.getGenerativeModel({ model }).generateContent(...)`).
- How to read the response text (likely `response.text` or `response.text()`).

If the API differs from what's shown below, adapt `generateJSON`'s body but keep the public surface (`MODEL_ID`, `extractJSON`, `withRetry`, `generateJSON`) identical so the rest of the plan works unchanged.

- [ ] **Step 2.2: Write the failing tests**

Create `src/lib/__tests__/gemini.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractJSON, withRetry } from '@/lib/gemini';

describe('extractJSON', () => {
  it('parses a plain JSON string', () => {
    expect(extractJSON<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it('strips a ```json code fence', () => {
    const text = '```json\n{"a": 1}\n```';
    expect(extractJSON<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it('strips a generic ``` code fence', () => {
    const text = '```\n{"a": 1}\n```';
    expect(extractJSON<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it('strips leading/trailing whitespace', () => {
    expect(extractJSON<{ a: number }>('  {"a": 1}  ')).toEqual({ a: 1 });
  });

  it('throws on invalid JSON', () => {
    expect(() => extractJSON('not json')).toThrow();
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result when the first call succeeds', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 with exponential backoff', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 10 });
    // First failure → wait 10ms
    await vi.advanceTimersByTimeAsync(10);
    // Second failure → wait 20ms
    await vi.advanceTimersByTimeAsync(20);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting attempts', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(err);

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 10 });
    promise.catch(() => {}); // prevent unhandled rejection
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    await expect(promise).rejects.toThrow('rate limited');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-429 errors', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 10 })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2.3: Run the tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/gemini.test.ts`
Expected: FAIL with "Cannot find module '@/lib/gemini'".

- [ ] **Step 2.4: Implement `src/lib/gemini.ts`**

```ts
import { GoogleGenAI } from '@google/genai';

export const MODEL_ID = 'gemini-2.5-flash';

let cachedClient: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Add it to .env.local.');
  }
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

export function extractJSON<T>(text: string): T {
  let cleaned = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const match = cleaned.match(fence);
  if (match) cleaned = match[1].trim();
  return JSON.parse(cleaned) as T;
}

type RetryOpts = { attempts?: number; baseDelayMs?: number };

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 10_000; // 10s
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 429) throw err;
      if (i === attempts - 1) break;
      const delay = baseDelayMs * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

export async function generateJSON<T>(prompt: string): Promise<T> {
  return withRetry(async () => {
    const response = await client().models.generateContent({
      model: MODEL_ID,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    // The SDK exposes `.text` (string) on the response. If your installed
    // version exposes it as a method, change to `response.text()`.
    const text = (response as unknown as { text: string }).text;
    if (typeof text !== 'string') {
      throw new Error('Gemini response had no text payload.');
    }
    return extractJSON<T>(text);
  });
}
```

If `cat node_modules/@google/genai/README.md` showed a different shape (e.g. `client.getGenerativeModel({ model }).generateContent(prompt)`), adapt the inner call only — the public surface (`generateJSON`, `extractJSON`, `withRetry`, `MODEL_ID`) stays the same.

- [ ] **Step 2.5: Run the tests to verify they pass**

Run: `npm run test:run -- src/lib/__tests__/gemini.test.ts`
Expected: 9 tests pass.

- [ ] **Step 2.6: Run the full suite**

Run: `npm run test:run`
Expected: 25 tests pass total (16 from Plan A + 9 new).

- [ ] **Step 2.7: Commit**

```bash
git add src/lib/gemini.ts src/lib/__tests__/gemini.test.ts
git commit -m "feat: add Gemini client wrapper with retry and JSON extraction"
```

---

## Task 3: Prompts module (TDD)

**Files:**
- Create: `src/lib/prompts.ts`
- Create: `src/lib/__tests__/prompts.test.ts`

Three prompt-builder functions: `buildParseSpecPrompt(spec)`, `buildGenerateTestsPrompt(parsed)`, `buildGenerateRubricPrompt(parsed)`. Each returns a string. Tests verify the output contains the input fields (template substitution works) and the output schema instruction.

- [ ] **Step 3.1: Write the failing tests**

Create `src/lib/__tests__/prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildParseSpecPrompt,
  buildGenerateTestsPrompt,
  buildGenerateRubricPrompt,
} from '@/lib/prompts';
import type { ParsedSpec } from '@/lib/types';

const SAMPLE_PARSED: ParsedSpec = {
  feature: 'Cold email drafter',
  inputs: ['LinkedIn profile', 'company website'],
  outputs: ['email body under 150 words'],
  constraints: ['references one profile detail', 'one case study'],
  domain: 'sales',
};

describe('buildParseSpecPrompt', () => {
  it('embeds the raw spec text', () => {
    const p = buildParseSpecPrompt('AI summarizes invoices.');
    expect(p).toContain('AI summarizes invoices.');
  });

  it('asks for a JSON response with the expected keys', () => {
    const p = buildParseSpecPrompt('any');
    expect(p).toContain('feature');
    expect(p).toContain('inputs');
    expect(p).toContain('outputs');
    expect(p).toContain('constraints');
    expect(p).toContain('domain');
    expect(p).toMatch(/legal|sales|healthcare|general/);
  });
});

describe('buildGenerateTestsPrompt', () => {
  it('embeds the feature, inputs, outputs, constraints, and domain', () => {
    const p = buildGenerateTestsPrompt(SAMPLE_PARSED);
    expect(p).toContain('Cold email drafter');
    expect(p).toContain('LinkedIn profile');
    expect(p).toContain('email body under 150 words');
    expect(p).toContain('references one profile detail');
    expect(p).toContain('sales');
  });

  it('asks for exactly 20 test cases', () => {
    const p = buildGenerateTestsPrompt(SAMPLE_PARSED);
    expect(p).toMatch(/20/);
  });

  it('asks for the three categories', () => {
    const p = buildGenerateTestsPrompt(SAMPLE_PARSED);
    expect(p).toContain('happy_path');
    expect(p).toContain('edge_case');
    expect(p).toContain('adversarial');
  });
});

describe('buildGenerateRubricPrompt', () => {
  it('embeds the parsed spec context', () => {
    const p = buildGenerateRubricPrompt(SAMPLE_PARSED);
    expect(p).toContain('Cold email drafter');
    expect(p).toContain('sales');
  });

  it('asks for dimensions with id, label, description, weight', () => {
    const p = buildGenerateRubricPrompt(SAMPLE_PARSED);
    expect(p).toContain('id');
    expect(p).toContain('label');
    expect(p).toContain('description');
    expect(p).toContain('weight');
  });

  it('asks weights to sum to 1', () => {
    const p = buildGenerateRubricPrompt(SAMPLE_PARSED);
    expect(p).toMatch(/sum.*1/i);
  });
});
```

- [ ] **Step 3.2: Run the tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/prompts.test.ts`
Expected: FAIL with "Cannot find module '@/lib/prompts'".

- [ ] **Step 3.3: Implement `src/lib/prompts.ts`**

```ts
import type { ParsedSpec } from '@/lib/types';

export function buildParseSpecPrompt(spec: string): string {
  return `You are an evaluation engineer. Read the AI feature spec below and return a single JSON object describing it.

Spec:
"""
${spec}
"""

Respond with ONLY a JSON object matching this exact schema (no prose, no markdown):

{
  "feature": "one-sentence summary of what the feature does",
  "inputs": ["bullet", "list", "of", "what the AI receives"],
  "outputs": ["bullet", "list", "of", "what the AI produces"],
  "constraints": ["bullet", "list", "of", "requirements the output must satisfy"],
  "domain": "legal" | "sales" | "healthcare" | "general"
}

Rules:
- Pick "domain" by matching the spec's subject. Use "general" if none of the three fit.
- Each list should have 1-6 short, specific items. No duplicates.
- Output JSON only.`;
}

export function buildGenerateTestsPrompt(parsed: ParsedSpec): string {
  return `You are an evaluation engineer. Generate a suite of 20 test cases for the AI feature below.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Generate exactly 20 tests, distributed roughly:
- 8 happy_path tests (typical valid inputs that should pass)
- 7 edge_case tests (unusual but legal inputs: empty fields, very long inputs, ambiguity, multiple correct answers)
- 5 adversarial tests (inputs designed to surface a likely failure mode for this domain)

Each test must include a realistic, domain-appropriate \`input\` string. The input is what the feature will receive at runtime — not a description of the test.

Respond with ONLY a JSON array (no prose, no markdown), matching this schema:

[
  {
    "id": "test-01",
    "category": "happy_path" | "edge_case" | "adversarial",
    "input": "the literal input the feature will receive",
    "notes": "optional 1-line reason this test exists"
  },
  ...
]

Rules:
- IDs are zero-padded: test-01 through test-20.
- Inputs are concrete strings, not placeholders.
- Output JSON only.`;
}

export function buildGenerateRubricPrompt(parsed: ParsedSpec): string {
  return `You are an evaluation engineer. Define a scoring rubric for the AI feature below.

Feature: ${parsed.feature}
Domain: ${parsed.domain}
Inputs:
${parsed.inputs.map((s) => `- ${s}`).join('\n')}
Outputs:
${parsed.outputs.map((s) => `- ${s}`).join('\n')}
Constraints:
${parsed.constraints.map((s) => `- ${s}`).join('\n')}

Pick 4-6 scoring dimensions tailored to this domain and feature. Avoid generic dimensions like "quality" or "helpfulness" — every dimension should reflect a real failure mode for THIS feature.

Respond with ONLY a JSON object (no prose, no markdown), matching this schema:

{
  "dimensions": [
    {
      "id": "kebab-case-id",
      "label": "Human-readable label",
      "description": "1-2 sentences explaining what we are scoring",
      "weight": 0.0
    }
  ]
}

Rules:
- 4-6 dimensions.
- weight values are floats in [0, 1] and the sum must equal 1.0 (within ±0.01).
- Output JSON only.`;
}
```

- [ ] **Step 3.4: Run the tests to verify they pass**

Run: `npm run test:run -- src/lib/__tests__/prompts.test.ts`
Expected: 9 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/prompts.ts src/lib/__tests__/prompts.test.ts
git commit -m "feat: add prompt builders for parse, tests, and rubric"
```

---

## Task 4: `/api/parse-spec` route handler (TDD)

**Files:**
- Create: `src/app/api/parse-spec/route.ts`
- Create: `src/app/api/parse-spec/__tests__/route.test.ts`

POST. Body: `{ spec: string }`. Response: `ParsedSpec` JSON. On error: `{ error: string }` with status 500 (or 400 for bad input).

- [ ] **Step 4.1: Write the failing tests**

Create `src/app/api/parse-spec/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { POST } from '@/app/api/parse-spec/route';
import { generateJSON } from '@/lib/gemini';

const mockedGenerateJSON = vi.mocked(generateJSON);

beforeEach(() => {
  mockedGenerateJSON.mockReset();
});

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/parse-spec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/parse-spec', () => {
  it('returns the parsed spec on success', async () => {
    mockedGenerateJSON.mockResolvedValueOnce({
      feature: 'Cold email drafter',
      inputs: ['LinkedIn profile'],
      outputs: ['email under 150 words'],
      constraints: ['one case study'],
      domain: 'sales',
    });

    const res = await POST(makeRequest({ spec: 'AI drafts cold emails.' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      feature: 'Cold email drafter',
      inputs: ['LinkedIn profile'],
      outputs: ['email under 150 words'],
      constraints: ['one case study'],
      domain: 'sales',
    });
    expect(mockedGenerateJSON).toHaveBeenCalledOnce();
    const promptArg = mockedGenerateJSON.mock.calls[0][0];
    expect(promptArg).toContain('AI drafts cold emails.');
  });

  it('returns 400 when spec is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/spec/i);
    expect(mockedGenerateJSON).not.toHaveBeenCalled();
  });

  it('returns 400 when spec is empty after trim', async () => {
    const res = await POST(makeRequest({ spec: '   ' }));
    expect(res.status).toBe(400);
    expect(mockedGenerateJSON).not.toHaveBeenCalled();
  });

  it('returns 500 when Gemini throws', async () => {
    mockedGenerateJSON.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(makeRequest({ spec: 'a real spec' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
```

- [ ] **Step 4.2: Run the tests to verify they fail**

Run: `npm run test:run -- src/app/api/parse-spec/__tests__/route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/parse-spec/route'".

- [ ] **Step 4.3: Implement `src/app/api/parse-spec/route.ts`**

```ts
import { generateJSON } from '@/lib/gemini';
import { buildParseSpecPrompt } from '@/lib/prompts';
import type { ParsedSpec } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

  try {
    const parsed = await generateJSON<ParsedSpec>(buildParseSpecPrompt(spec.trim()));
    return Response.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4.4: Run the tests to verify they pass**

Run: `npm run test:run -- src/app/api/parse-spec/__tests__/route.test.ts`
Expected: 4 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/app/api/parse-spec/route.ts src/app/api/parse-spec/__tests__/route.test.ts
git commit -m "feat: add POST /api/parse-spec route"
```

---

## Task 5: DomainBadge component (TDD)

**Files:**
- Create: `src/components/DomainBadge.tsx`
- Create: `src/components/__tests__/DomainBadge.test.tsx`

Small badge that shows the detected domain with a domain-specific accent color.

- [ ] **Step 5.1: Write the failing tests**

Create `src/components/__tests__/DomainBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DomainBadge from '@/components/DomainBadge';

describe('DomainBadge', () => {
  it('renders the legal label', () => {
    render(<DomainBadge domain="legal" />);
    expect(screen.getByText(/legal/i)).toBeInTheDocument();
  });

  it('renders the sales label', () => {
    render(<DomainBadge domain="sales" />);
    expect(screen.getByText(/sales/i)).toBeInTheDocument();
  });

  it('renders the healthcare label', () => {
    render(<DomainBadge domain="healthcare" />);
    expect(screen.getByText(/healthcare/i)).toBeInTheDocument();
  });

  it('renders the general label', () => {
    render(<DomainBadge domain="general" />);
    expect(screen.getByText(/general/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run the tests to verify they fail**

Run: `npm run test:run -- src/components/__tests__/DomainBadge.test.tsx`
Expected: FAIL with "Cannot find module '@/components/DomainBadge'".

- [ ] **Step 5.3: Implement `src/components/DomainBadge.tsx`**

```tsx
import type { Domain } from '@/lib/types';

const STYLES: Record<Domain, { label: string; className: string }> = {
  legal: {
    label: 'Legal',
    className: 'bg-elevated border-border text-fg',
  },
  sales: {
    label: 'Sales',
    className: 'bg-elevated border-border text-fg',
  },
  healthcare: {
    label: 'Healthcare',
    className: 'bg-elevated border-border text-fg',
  },
  general: {
    label: 'General',
    className: 'bg-elevated border-border text-muted',
  },
};

export default function DomainBadge({ domain }: { domain: Domain }) {
  const style = STYLES[domain];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs ${style.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      {style.label}
    </span>
  );
}
```

- [ ] **Step 5.4: Run the tests to verify they pass**

Run: `npm run test:run -- src/components/__tests__/DomainBadge.test.tsx`
Expected: 4 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/DomainBadge.tsx src/components/__tests__/DomainBadge.test.tsx
git commit -m "feat: add DomainBadge component"
```

---

## Task 6: `/api/generate-tests` route handler (TDD)

**Files:**
- Create: `src/app/api/generate-tests/route.ts`
- Create: `src/app/api/generate-tests/__tests__/route.test.ts`

POST. Body: `{ parsed: ParsedSpec }`. Response: `{ tests: TestCase[] }`. Validates the response has 20 entries and reasonable category distribution.

- [ ] **Step 6.1: Write the failing tests**

Create `src/app/api/generate-tests/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedSpec, TestCase } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { POST } from '@/app/api/generate-tests/route';
import { generateJSON } from '@/lib/gemini';

const mockedGenerateJSON = vi.mocked(generateJSON);

beforeEach(() => {
  mockedGenerateJSON.mockReset();
});

const PARSED: ParsedSpec = {
  feature: 'Cold email drafter',
  inputs: ['profile'],
  outputs: ['email'],
  constraints: ['under 150 words'],
  domain: 'sales',
};

function makeTests(n: number): TestCase[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `test-${String(i + 1).padStart(2, '0')}`,
    category: 'happy_path' as const,
    input: `input ${i + 1}`,
  }));
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/generate-tests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate-tests', () => {
  it('returns the test list on success', async () => {
    const tests = makeTests(20);
    mockedGenerateJSON.mockResolvedValueOnce(tests);
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tests).toHaveLength(20);
    expect(body.tests[0].id).toBe('test-01');
  });

  it('returns 400 when parsed is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockedGenerateJSON).not.toHaveBeenCalled();
  });

  it('returns 500 when Gemini returns fewer than 1 test', async () => {
    mockedGenerateJSON.mockResolvedValueOnce([]);
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/test/i);
  });

  it('returns 500 when Gemini throws', async () => {
    mockedGenerateJSON.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(500);
  });

  it('passes parsed spec context into the prompt', async () => {
    mockedGenerateJSON.mockResolvedValueOnce(makeTests(20));
    await POST(makeRequest({ parsed: PARSED }));
    const promptArg = mockedGenerateJSON.mock.calls[0][0];
    expect(promptArg).toContain('Cold email drafter');
    expect(promptArg).toContain('sales');
  });
});
```

- [ ] **Step 6.2: Run the tests to verify they fail**

Run: `npm run test:run -- src/app/api/generate-tests/__tests__/route.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 6.3: Implement `src/app/api/generate-tests/route.ts`**

```ts
import { generateJSON } from '@/lib/gemini';
import { buildGenerateTestsPrompt } from '@/lib/prompts';
import type { ParsedSpec, TestCase } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

function isParsedSpec(value: unknown): value is ParsedSpec {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.feature === 'string' &&
    Array.isArray(v.inputs) &&
    Array.isArray(v.outputs) &&
    Array.isArray(v.constraints) &&
    typeof v.domain === 'string'
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
    return Response.json({ error: 'parsed must be a ParsedSpec object.' }, { status: 400 });
  }

  try {
    const tests = await generateJSON<TestCase[]>(buildGenerateTestsPrompt(parsed));
    if (!Array.isArray(tests) || tests.length === 0) {
      return Response.json(
        { error: 'Gemini returned no tests.' },
        { status: 500 },
      );
    }
    return Response.json({ tests });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 6.4: Run the tests to verify they pass**

Run: `npm run test:run -- src/app/api/generate-tests/__tests__/route.test.ts`
Expected: 5 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/app/api/generate-tests/route.ts src/app/api/generate-tests/__tests__/route.test.ts
git commit -m "feat: add POST /api/generate-tests route"
```

---

## Task 7: TestSuiteTable component (TDD)

**Files:**
- Create: `src/components/TestSuiteTable.tsx`
- Create: `src/components/__tests__/TestSuiteTable.test.tsx`

Renders the 20 tests as a table: ID | Category | Input. Category colored by type.

- [ ] **Step 7.1: Write the failing tests**

Create `src/components/__tests__/TestSuiteTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TestSuiteTable from '@/components/TestSuiteTable';
import type { TestCase } from '@/lib/types';

const SAMPLE: TestCase[] = [
  { id: 'test-01', category: 'happy_path', input: 'a normal email' },
  { id: 'test-02', category: 'edge_case', input: 'an empty profile' },
  { id: 'test-03', category: 'adversarial', input: 'jailbreak attempt' },
];

describe('TestSuiteTable', () => {
  it('renders one row per test', () => {
    render(<TestSuiteTable tests={SAMPLE} />);
    expect(screen.getByText('test-01')).toBeInTheDocument();
    expect(screen.getByText('test-02')).toBeInTheDocument();
    expect(screen.getByText('test-03')).toBeInTheDocument();
  });

  it('renders the input text for each row', () => {
    render(<TestSuiteTable tests={SAMPLE} />);
    expect(screen.getByText('a normal email')).toBeInTheDocument();
    expect(screen.getByText('an empty profile')).toBeInTheDocument();
    expect(screen.getByText('jailbreak attempt')).toBeInTheDocument();
  });

  it('renders the category labels', () => {
    render(<TestSuiteTable tests={SAMPLE} />);
    expect(screen.getByText(/happy/i)).toBeInTheDocument();
    expect(screen.getByText(/edge/i)).toBeInTheDocument();
    expect(screen.getByText(/adversarial/i)).toBeInTheDocument();
  });

  it('renders an empty state when no tests', () => {
    render(<TestSuiteTable tests={[]} />);
    expect(screen.getByText(/no tests/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7.2: Run the tests to verify they fail**

Run: `npm run test:run -- src/components/__tests__/TestSuiteTable.test.tsx`
Expected: FAIL.

- [ ] **Step 7.3: Implement `src/components/TestSuiteTable.tsx`**

```tsx
import type { TestCase } from '@/lib/types';

const CATEGORY_LABEL: Record<TestCase['category'], string> = {
  happy_path: 'Happy path',
  edge_case: 'Edge case',
  adversarial: 'Adversarial',
};

export default function TestSuiteTable({ tests }: { tests: TestCase[] }) {
  if (tests.length === 0) {
    return (
      <p className="font-body text-sm text-muted">No tests generated.</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-left">
        <thead className="bg-elevated">
          <tr className="font-mono text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-2 w-24">ID</th>
            <th className="px-4 py-2 w-36">Category</th>
            <th className="px-4 py-2">Input</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => (
            <tr
              key={t.id}
              className="border-t border-border bg-surface align-top"
            >
              <td className="px-4 py-2 font-mono text-xs text-muted">{t.id}</td>
              <td className="px-4 py-2 font-body text-xs text-fg">
                {CATEGORY_LABEL[t.category]}
              </td>
              <td className="px-4 py-2 font-body text-sm text-fg">{t.input}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7.4: Run the tests to verify they pass**

Run: `npm run test:run -- src/components/__tests__/TestSuiteTable.test.tsx`
Expected: 4 tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/components/TestSuiteTable.tsx src/components/__tests__/TestSuiteTable.test.tsx
git commit -m "feat: add TestSuiteTable component"
```

---

## Task 8: `/api/generate-rubric` route handler (TDD)

**Files:**
- Create: `src/app/api/generate-rubric/route.ts`
- Create: `src/app/api/generate-rubric/__tests__/route.test.ts`

POST. Body: `{ parsed: ParsedSpec }`. Response: `Rubric` JSON.

- [ ] **Step 8.1: Write the failing tests**

Create `src/app/api/generate-rubric/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedSpec, Rubric } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { POST } from '@/app/api/generate-rubric/route';
import { generateJSON } from '@/lib/gemini';

const mockedGenerateJSON = vi.mocked(generateJSON);

beforeEach(() => {
  mockedGenerateJSON.mockReset();
});

const PARSED: ParsedSpec = {
  feature: 'Cold email drafter',
  inputs: ['profile'],
  outputs: ['email'],
  constraints: ['under 150 words'],
  domain: 'sales',
};

const RUBRIC: Rubric = {
  dimensions: [
    { id: 'personalization', label: 'Personalization', description: 'Refers to a specific profile detail.', weight: 0.5 },
    { id: 'concision', label: 'Concision', description: 'Stays under 150 words.', weight: 0.5 },
  ],
};

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/generate-rubric', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate-rubric', () => {
  it('returns the rubric on success', async () => {
    mockedGenerateJSON.mockResolvedValueOnce(RUBRIC);
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RUBRIC);
  });

  it('returns 400 when parsed is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 500 when Gemini returns no dimensions', async () => {
    mockedGenerateJSON.mockResolvedValueOnce({ dimensions: [] });
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(500);
  });

  it('returns 500 when Gemini throws', async () => {
    mockedGenerateJSON.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(500);
  });

  it('passes parsed spec context into the prompt', async () => {
    mockedGenerateJSON.mockResolvedValueOnce(RUBRIC);
    await POST(makeRequest({ parsed: PARSED }));
    const promptArg = mockedGenerateJSON.mock.calls[0][0];
    expect(promptArg).toContain('Cold email drafter');
    expect(promptArg).toContain('sales');
  });
});
```

- [ ] **Step 8.2: Run the tests to verify they fail**

Run: `npm run test:run -- src/app/api/generate-rubric/__tests__/route.test.ts`
Expected: FAIL.

- [ ] **Step 8.3: Implement `src/app/api/generate-rubric/route.ts`**

```ts
import { generateJSON } from '@/lib/gemini';
import { buildGenerateRubricPrompt } from '@/lib/prompts';
import type { ParsedSpec, Rubric } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

function isParsedSpec(value: unknown): value is ParsedSpec {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.feature === 'string' &&
    Array.isArray(v.inputs) &&
    Array.isArray(v.outputs) &&
    Array.isArray(v.constraints) &&
    typeof v.domain === 'string'
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
    return Response.json({ error: 'parsed must be a ParsedSpec object.' }, { status: 400 });
  }

  try {
    const rubric = await generateJSON<Rubric>(buildGenerateRubricPrompt(parsed));
    if (!rubric.dimensions || rubric.dimensions.length === 0) {
      return Response.json(
        { error: 'Gemini returned no rubric dimensions.' },
        { status: 500 },
      );
    }
    return Response.json(rubric);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return Response.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 8.4: Run the tests to verify they pass**

Run: `npm run test:run -- src/app/api/generate-rubric/__tests__/route.test.ts`
Expected: 5 tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add src/app/api/generate-rubric/route.ts src/app/api/generate-rubric/__tests__/route.test.ts
git commit -m "feat: add POST /api/generate-rubric route"
```

---

## Task 9: RubricPanel component (TDD)

**Files:**
- Create: `src/components/RubricPanel.tsx`
- Create: `src/components/__tests__/RubricPanel.test.tsx`

Card listing rubric dimensions: label, description, weight (rendered as percentage).

- [ ] **Step 9.1: Write the failing tests**

Create `src/components/__tests__/RubricPanel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RubricPanel from '@/components/RubricPanel';
import type { Rubric } from '@/lib/types';

const RUBRIC: Rubric = {
  dimensions: [
    { id: 'personalization', label: 'Personalization', description: 'Refers to a specific profile detail.', weight: 0.5 },
    { id: 'concision', label: 'Concision', description: 'Stays under 150 words.', weight: 0.5 },
  ],
};

describe('RubricPanel', () => {
  it('renders each dimension label', () => {
    render(<RubricPanel rubric={RUBRIC} />);
    expect(screen.getByText('Personalization')).toBeInTheDocument();
    expect(screen.getByText('Concision')).toBeInTheDocument();
  });

  it('renders each dimension description', () => {
    render(<RubricPanel rubric={RUBRIC} />);
    expect(screen.getByText(/profile detail/i)).toBeInTheDocument();
    expect(screen.getByText(/150 words/i)).toBeInTheDocument();
  });

  it('renders each weight as a percentage', () => {
    render(<RubricPanel rubric={RUBRIC} />);
    const fifties = screen.getAllByText(/50%/);
    expect(fifties.length).toBeGreaterThanOrEqual(2);
  });

  it('renders an empty state when there are no dimensions', () => {
    render(<RubricPanel rubric={{ dimensions: [] }} />);
    expect(screen.getByText(/no rubric/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9.2: Run the tests to verify they fail**

Run: `npm run test:run -- src/components/__tests__/RubricPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 9.3: Implement `src/components/RubricPanel.tsx`**

```tsx
import type { Rubric } from '@/lib/types';

export default function RubricPanel({ rubric }: { rubric: Rubric }) {
  if (rubric.dimensions.length === 0) {
    return <p className="font-body text-sm text-muted">No rubric dimensions.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {rubric.dimensions.map((d) => (
        <li
          key={d.id}
          className="flex items-start justify-between gap-4 rounded-md border border-border bg-surface px-4 py-3"
        >
          <div className="flex flex-col gap-1">
            <span className="font-display text-sm text-fg">{d.label}</span>
            <span className="font-body text-xs text-muted">{d.description}</span>
          </div>
          <span className="font-mono text-xs text-accent shrink-0">
            {Math.round(d.weight * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 9.4: Run the tests to verify they pass**

Run: `npm run test:run -- src/components/__tests__/RubricPanel.test.tsx`
Expected: 4 tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add src/components/RubricPanel.tsx src/components/__tests__/RubricPanel.test.tsx
git commit -m "feat: add RubricPanel component"
```

---

## Task 10: Page state machine (TDD)

**Files:**
- Create: `src/lib/pageReducer.ts`
- Create: `src/lib/__tests__/pageReducer.test.ts`
- Modify: `src/app/page.tsx`

Extract the reducer as a pure module so it can be unit-tested without rendering. The page imports it.

- [ ] **Step 10.1: Write the failing reducer tests**

Create `src/lib/__tests__/pageReducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialState, reducer } from '@/lib/pageReducer';
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

const PARSED: ParsedSpec = {
  feature: 'F',
  inputs: ['i'],
  outputs: ['o'],
  constraints: ['c'],
  domain: 'sales',
};

const TESTS: TestCase[] = [
  { id: 'test-01', category: 'happy_path', input: 'in' },
];

const RUBRIC: Rubric = {
  dimensions: [{ id: 'a', label: 'A', description: 'd', weight: 1 }],
};

describe('pageReducer', () => {
  it('starts in idle state', () => {
    expect(initialState.status).toBe('idle');
  });

  it('PARSE_STARTED → parsing', () => {
    const s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'hello' });
    expect(s.status).toBe('parsing');
    expect(s.spec).toBe('hello');
    expect(s.error).toBeNull();
  });

  it('PARSE_SUCCEEDED → tests_generating, stores parsed', () => {
    const a = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    const b = reducer(a, { type: 'PARSE_SUCCEEDED', parsed: PARSED });
    expect(b.status).toBe('tests_generating');
    expect(b.parsed).toEqual(PARSED);
  });

  it('TESTS_SUCCEEDED → rubric_generating, stores tests', () => {
    let s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    s = reducer(s, { type: 'PARSE_SUCCEEDED', parsed: PARSED });
    s = reducer(s, { type: 'TESTS_SUCCEEDED', tests: TESTS });
    expect(s.status).toBe('rubric_generating');
    expect(s.tests).toEqual(TESTS);
  });

  it('RUBRIC_SUCCEEDED → ready, stores rubric', () => {
    let s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    s = reducer(s, { type: 'PARSE_SUCCEEDED', parsed: PARSED });
    s = reducer(s, { type: 'TESTS_SUCCEEDED', tests: TESTS });
    s = reducer(s, { type: 'RUBRIC_SUCCEEDED', rubric: RUBRIC });
    expect(s.status).toBe('ready');
    expect(s.rubric).toEqual(RUBRIC);
  });

  it('FAILED → error, stores message', () => {
    let s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    s = reducer(s, { type: 'FAILED', error: 'boom' });
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('RESET → back to idle', () => {
    let s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    s = reducer(s, { type: 'PARSE_SUCCEEDED', parsed: PARSED });
    s = reducer(s, { type: 'RESET' });
    expect(s).toEqual(initialState);
  });
});
```

- [ ] **Step 10.2: Run the tests to verify they fail**

Run: `npm run test:run -- src/lib/__tests__/pageReducer.test.ts`
Expected: FAIL with "Cannot find module '@/lib/pageReducer'".

- [ ] **Step 10.3: Implement `src/lib/pageReducer.ts`**

```ts
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

export type PageStatus =
  | 'idle'
  | 'parsing'
  | 'tests_generating'
  | 'rubric_generating'
  | 'ready'
  | 'error';

export type PageState = {
  status: PageStatus;
  spec: string;
  parsed: ParsedSpec | null;
  tests: TestCase[] | null;
  rubric: Rubric | null;
  error: string | null;
};

export type PageAction =
  | { type: 'PARSE_STARTED'; spec: string }
  | { type: 'PARSE_SUCCEEDED'; parsed: ParsedSpec }
  | { type: 'TESTS_STARTED' }
  | { type: 'TESTS_SUCCEEDED'; tests: TestCase[] }
  | { type: 'RUBRIC_STARTED' }
  | { type: 'RUBRIC_SUCCEEDED'; rubric: Rubric }
  | { type: 'FAILED'; error: string }
  | { type: 'RESET' };

export const initialState: PageState = {
  status: 'idle',
  spec: '',
  parsed: null,
  tests: null,
  rubric: null,
  error: null,
};

export function reducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case 'PARSE_STARTED':
      return {
        ...initialState,
        status: 'parsing',
        spec: action.spec,
      };
    case 'PARSE_SUCCEEDED':
      return {
        ...state,
        status: 'tests_generating',
        parsed: action.parsed,
      };
    case 'TESTS_STARTED':
      return { ...state, status: 'tests_generating' };
    case 'TESTS_SUCCEEDED':
      return {
        ...state,
        status: 'rubric_generating',
        tests: action.tests,
      };
    case 'RUBRIC_STARTED':
      return { ...state, status: 'rubric_generating' };
    case 'RUBRIC_SUCCEEDED':
      return {
        ...state,
        status: 'ready',
        rubric: action.rubric,
      };
    case 'FAILED':
      return { ...state, status: 'error', error: action.error };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}
```

- [ ] **Step 10.4: Run the reducer tests**

Run: `npm run test:run -- src/lib/__tests__/pageReducer.test.ts`
Expected: 7 tests pass.

- [ ] **Step 10.5: Replace `src/app/page.tsx` with the orchestrator**

Replace the **entire** contents of `src/app/page.tsx`:

```tsx
'use client';

import { useReducer } from 'react';
import SpecForm from '@/components/SpecForm';
import DomainBadge from '@/components/DomainBadge';
import TestSuiteTable from '@/components/TestSuiteTable';
import RubricPanel from '@/components/RubricPanel';
import { initialState, reducer } from '@/lib/pageReducer';
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return (await res.json()) as T;
}

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);

  async function run(spec: string) {
    dispatch({ type: 'PARSE_STARTED', spec });
    try {
      const parsed = await postJSON<ParsedSpec>('/api/parse-spec', { spec });
      dispatch({ type: 'PARSE_SUCCEEDED', parsed });

      const testsResp = await postJSON<{ tests: TestCase[] }>(
        '/api/generate-tests',
        { parsed },
      );
      dispatch({ type: 'TESTS_SUCCEEDED', tests: testsResp.tests });

      const rubric = await postJSON<Rubric>('/api/generate-rubric', { parsed });
      dispatch({ type: 'RUBRIC_SUCCEEDED', rubric });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      dispatch({ type: 'FAILED', error: message });
    }
  }

  const busy =
    state.status === 'parsing' ||
    state.status === 'tests_generating' ||
    state.status === 'rubric_generating';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-4xl text-fg">EvalForge</h1>
        <p className="font-body text-base text-muted max-w-2xl">
          Paste an AI feature spec. Get a domain-aware eval suite that runs.
        </p>
      </header>

      <SpecForm onSubmit={run} />

      {state.status === 'parsing' && (
        <p className="font-mono text-xs text-muted">Parsing spec…</p>
      )}

      {state.parsed && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl text-fg">Parsed spec</h2>
            <DomainBadge domain={state.parsed.domain} />
          </div>
          <div className="rounded-md border border-border bg-surface p-4 font-mono text-xs text-muted whitespace-pre-wrap">
            {JSON.stringify(state.parsed, null, 2)}
          </div>
        </section>
      )}

      {state.status === 'tests_generating' && (
        <p className="font-mono text-xs text-muted">Generating tests…</p>
      )}

      {state.tests && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-fg">
            Test suite ({state.tests.length})
          </h2>
          <TestSuiteTable tests={state.tests} />
        </section>
      )}

      {state.status === 'rubric_generating' && (
        <p className="font-mono text-xs text-muted">Generating rubric…</p>
      )}

      {state.rubric && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-fg">Rubric</h2>
          <RubricPanel rubric={state.rubric} />
        </section>
      )}

      {state.status === 'ready' && (
        <p className="font-mono text-xs text-success">Ready. Plan C wires the runner.</p>
      )}

      {state.status === 'error' && state.error && (
        <p className="font-mono text-xs text-failure">Error: {state.error}</p>
      )}

      {busy && (
        <p className="sr-only" role="status">Working…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 10.6: Run the full suite**

Run: `npm run test:run`
Expected: all earlier tests + the 7 new reducer tests pass. With Plan B prior tasks: sanity 1 + Nav 3 + Footer 2 + SpecInput 4 + SpecForm 6 + gemini 9 + prompts 9 + parse-spec 4 + DomainBadge 4 + generate-tests 5 + TestSuiteTable 4 + generate-rubric 5 + RubricPanel 4 + pageReducer 7 = **67 tests** passing.

- [ ] **Step 10.7: Production build sanity-check**

Run: `npm run build`
Expected: clean build, 4 routes (/, /_not-found, plus the three new POST API routes which Next.js lists under `/api/...`).

- [ ] **Step 10.8: Commit**

```bash
git add src/lib/pageReducer.ts src/lib/__tests__/pageReducer.test.ts src/app/page.tsx
git commit -m "feat: wire page state machine through the generation pipeline"
```

---

## Task 11: Manual smoke test + final verification

**Files:**
- None (verification only)

This task gates the plan. Each example chip must produce a parsed spec, 20 tests, and a rubric with no errors.

- [ ] **Step 11.1: Confirm `.env.local` has a real key**

```bash
cat .env.local 2>/dev/null | grep GEMINI_API_KEY
```

If the file doesn't exist, copy the template and add your key from <https://aistudio.google.com/apikey>:

```bash
cp .env.local.example .env.local
# then edit .env.local to fill in GEMINI_API_KEY=...
```

`.env.local` is gitignored. Never commit it.

- [ ] **Step 11.2: Start the dev server and run each example**

```bash
npm run dev
```

Open <http://localhost:3000>. For each of the three chips (Legal, Sales, Healthcare):

1. Click the chip. Verify the textarea fills.
2. Click "Generate Eval Suite".
3. Observe in order:
   - "Parsing spec…" appears, then disappears.
   - Parsed-spec card appears with `domain` matching the chip (legal → "Legal", etc.).
   - "Generating tests…" appears, then a 20-row test table appears.
   - "Generating rubric…" appears, then a 4-6 dimension rubric appears.
   - "Ready. Plan C wires the runner." appears.
4. Open DevTools → Network tab. Confirm three 200 responses: `/api/parse-spec`, `/api/generate-tests`, `/api/generate-rubric`.
5. If any step fails: read the error, check the Gemini console output (`npm run dev` terminal), iterate on the prompt only if necessary.

Record the results in your scratch notes. The plan is not done until all three examples pass.

- [ ] **Step 11.3: Stop the dev server**

Ctrl-C in the terminal running `npm run dev`.

- [ ] **Step 11.4: Re-run the full test suite**

```bash
npm run test:run
```

Expected: 67 tests pass.

- [ ] **Step 11.5: Run lint and build**

```bash
npm run lint
npm run build
```

Both must be clean.

- [ ] **Step 11.6: Final commit (if any prompt iterations happened)**

If you adjusted any prompt during smoke testing:

```bash
git add src/lib/prompts.ts
git commit -m "chore: tune prompts based on smoke test feedback"
```

If no changes, skip this step.

---

## Plan B — Done-When checklist

- [ ] `npm run test:run` exits 0 with all tests passing (67 tests).
- [ ] `npm run build` completes without errors.
- [ ] `npm run lint` reports no errors.
- [ ] All three example chips (Legal, Sales, Healthcare) produce a parsed spec, 20-row test table, and 4-6 dimension rubric end-to-end.
- [ ] Domain badge color/label matches the chip clicked.
- [ ] Network tab shows three 200 responses per run.
- [ ] All commits use Conventional Commits (`feat:`, `chore:`).

When this is green, hand off to **Plan C (Eval runner + scorecard)**.

---

## Out of scope for Plan B (handled in C)

- `runBatched` / batched concurrency in `lib/gemini.ts`
- `/api/run-eval` SSE route
- `EvalRunner`, `Scorecard` components
- JSON export
- 5000-character input cap (defensive validation in routes already prevents abuse)
- Mobile responsive tuning
- OG image / additional metadata
- Real-Gemini tests in CI (every Gemini call is mocked at unit-test time)
