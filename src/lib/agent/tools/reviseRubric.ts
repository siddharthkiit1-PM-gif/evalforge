import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';
import type { Rubric } from '@/lib/types';

export type ReviseRubricInput = { reason: string };
export type ReviseRubricOutput = { revisedRubric: Rubric; changedDimensions: string[] };

function buildPrompt(rubric: Rubric, reason: string, domain: string, perDim: Record<string, number>): string {
  return `You are revising a scoring rubric for a ${domain} feature. The recent eval surfaced this issue:

${reason}

Current per-dimension scores: ${JSON.stringify(perDim)}

Current rubric:
${JSON.stringify(rubric, null, 2)}

Produce a revised rubric. You may rewrite descriptions for clarity, adjust weights (must still sum to 1.0 ± 0.01), and reorder. Keep the same dimension ids; do not add or remove dimensions.

Respond with ONLY a JSON object matching:

{
  "dimensions": [
    { "id": "...", "label": "...", "description": "...", "weight": 0.0 }
  ]
}`;
}

function changedIds(before: Rubric, after: Rubric): string[] {
  const beforeById = new Map(before.dimensions.map((d) => [d.id, d]));
  const changed: string[] = [];
  for (const a of after.dimensions) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    if (b.description !== a.description || Math.abs(b.weight - a.weight) > 1e-9 || b.label !== a.label) {
      changed.push(a.id);
    }
  }
  return changed;
}

export async function reviseRubric(
  input: ReviseRubricInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<ReviseRubricOutput>> {
  const revised = await generateJSON<Rubric>(
    buildPrompt(ctx.state.rubric, input.reason, ctx.state.parsed.domain, ctx.state.summary.perDimension),
  );
  const changedDimensions = changedIds(ctx.state.rubric, revised);
  return {
    public: { revisedRubric: revised, changedDimensions },
    stateUpdate: { rubric: revised },
  };
}
