import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';

export type TightenRubricDescriptorsInput = { dimensionId: string };
export type TightenRubricDescriptorsOutput = { before: string; after: string };

function buildPrompt(label: string, description: string, score: number, domain: string): string {
  return `You are tightening one rubric dimension for a ${domain} feature. The dimension is currently scoring ${score.toFixed(2)} — below the 0.7 pass bar — likely because the descriptor is too vague.

Dimension: ${label}
Current descriptor: ${description}

Rewrite the descriptor to be sharper and more specific. Make the pass/fail line concrete. 1-3 sentences. No marketing language.

Respond with ONLY a JSON object: { "description": "..." }`;
}

export async function tightenRubricDescriptors(
  input: TightenRubricDescriptorsInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<TightenRubricDescriptorsOutput>> {
  const target = ctx.state.rubric.dimensions.find((d) => d.id === input.dimensionId);
  if (!target) {
    throw new Error(`Unknown rubric dimension id: ${input.dimensionId}`);
  }
  const score = ctx.state.summary.perDimension[input.dimensionId] ?? 0;
  const out = await generateJSON<{ description: string }>(
    buildPrompt(target.label, target.description, score, ctx.state.parsed.domain),
  );
  const updatedDimensions = ctx.state.rubric.dimensions.map((d) =>
    d.id === input.dimensionId ? { ...d, description: out.description } : d,
  );
  return {
    public: { before: target.description, after: out.description },
    stateUpdate: { rubric: { dimensions: updatedDimensions } },
  };
}
