import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';
import type { TestCase } from '@/lib/types';

export type RewriteTestInput = { testId: string; reason: string };
export type RewriteTestOutput = { before: TestCase; after: TestCase };

function buildPrompt(test: TestCase, reason: string, domain: string): string {
  return `You are rewriting a test case for a ${domain} feature. The reason for the rewrite:

${reason}

Current test:
${JSON.stringify(test, null, 2)}

Produce a tighter, more realistic version. Same category. The input should read as something a real user would actually write — no test scaffolding language.

Respond with ONLY a JSON object: { "category": "happy_path" | "edge_case" | "adversarial", "input": "...", "notes": "optional" }`;
}

export async function rewriteTest(
  input: RewriteTestInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<RewriteTestOutput>> {
  const target = ctx.state.tests.find((t) => t.id === input.testId);
  if (!target) {
    throw new Error(`Unknown test id: ${input.testId}`);
  }
  const out = await generateJSON<Omit<TestCase, 'id'>>(
    buildPrompt(target, input.reason, ctx.state.parsed.domain),
  );
  const after: TestCase = { id: target.id, category: out.category, input: out.input, notes: out.notes };
  const updated = ctx.state.tests.map((t) => (t.id === target.id ? after : t));
  return { public: { before: target, after }, stateUpdate: { tests: updated } };
}
