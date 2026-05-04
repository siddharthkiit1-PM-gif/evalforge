import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';

export type DiagnoseFailuresInput = { dimensionId: string };
export type DiagnoseFailuresOutput = {
  patterns: string[];
  suggestedActions: string[];
};

const FAIL_THRESHOLD = 0.7;

function buildPrompt(
  dimensionId: string,
  failedCases: { testId: string; output: string; reasoning: string; score: number }[],
  domain: string,
): string {
  const cases = failedCases
    .map(
      (c, i) =>
        `Case ${i + 1} (${c.testId}, score ${c.score.toFixed(2)}):\n  Output: ${c.output}\n  Judge said: ${c.reasoning}`,
    )
    .join('\n\n');
  return `You are an evaluation diagnostician for a ${domain} feature. The dimension "${dimensionId}" is failing.

Failed cases on this dimension:
${cases}

Respond with ONLY a JSON object (no prose, no markdown) of this shape:

{
  "patterns": ["1-3 short failure patterns observed across the cases"],
  "suggestedActions": ["1-3 concrete actions: e.g. 'tighten the descriptor wording', 'add adversarial X tests', 'rewrite test-04'"]
}`;
}

export async function diagnoseFailures(
  input: DiagnoseFailuresInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<DiagnoseFailuresOutput>> {
  const failedCases = ctx.state.results
    .map((r) => {
      const s = r.scores.find((x) => x.dimensionId === input.dimensionId);
      if (!s || s.score >= FAIL_THRESHOLD) return null;
      return { testId: r.testId, output: r.output, reasoning: s.reasoning, score: s.score };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (failedCases.length === 0) {
    return { public: { patterns: [], suggestedActions: [] }, stateUpdate: {} };
  }

  const out = await generateJSON<DiagnoseFailuresOutput>(
    buildPrompt(input.dimensionId, failedCases, ctx.state.parsed.domain),
  );
  return { public: out, stateUpdate: {} };
}
