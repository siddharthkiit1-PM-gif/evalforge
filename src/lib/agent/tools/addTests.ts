import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';
import type { TestCase } from '@/lib/types';

export type AddTestsInput = { n: number; focusDimensionId?: string };
export type AddTestsOutput = { added: TestCase[] };

const MIN_N = 1;
const MAX_N = 10;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function nextIdNumber(tests: TestCase[]): number {
  const nums = tests
    .map((t) => Number(t.id.replace(/^test-/, '')))
    .filter((n) => Number.isFinite(n));
  return (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function buildPrompt(
  parsedDomain: string,
  feature: string,
  n: number,
  focusDimensionId?: string,
): string {
  const focus = focusDimensionId
    ? `\nFocus the new tests on surfacing failures for the rubric dimension "${focusDimensionId}".`
    : '';
  return `You are an evaluation engineer. Generate ${n} additional test cases for the AI feature below in the ${parsedDomain} domain.

Feature: ${feature}
${focus}

Each test must be realistic — write the input as a real user would phrase it, not as test scaffolding. Vary tone and length.

Respond with ONLY a JSON array (no prose, no markdown) of objects:

[
  { "id": "ignored", "category": "happy_path" | "edge_case" | "adversarial", "input": "the literal input", "notes": "optional 1-line reason" }
]

Generate exactly ${n} entries.`;
}

export async function addTests(
  input: AddTestsInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<AddTestsOutput>> {
  const n = clamp(input.n, MIN_N, MAX_N);
  const generated = await generateJSON<TestCase[]>(
    buildPrompt(ctx.state.parsed.domain, ctx.state.parsed.feature, n, input.focusDimensionId),
  );
  const trimmed = generated.slice(0, n);
  const start = nextIdNumber(ctx.state.tests);
  const added: TestCase[] = trimmed.map((t, i) => ({
    id: `test-${pad2(start + i)}`,
    category: t.category,
    input: t.input,
    notes: t.notes,
  }));
  return {
    public: { added },
    stateUpdate: { tests: [...ctx.state.tests, ...added] },
  };
}
