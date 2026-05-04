import { generateJSON } from '@/lib/gemini';
import { selectExemplars } from '@/lib/exemplars';
import { buildGenerateRubricPrompt } from '@/lib/prompts';
import type { Rubric } from '@/lib/types';
import type { OrchToolHandlerResult, OrchToolContext } from '@/lib/agent/orchestratorTools';

export type GenerateRubricInput = Record<string, never>;
export type GenerateRubricOutput = Rubric;

export async function generateRubricTool(
  _input: GenerateRubricInput,
  ctx: OrchToolContext,
): Promise<OrchToolHandlerResult<GenerateRubricOutput>> {
  if (!ctx.state.parsed) {
    throw new Error('generate_rubric requires parsed spec; call parse_spec first');
  }
  const exemplars = selectExemplars(ctx.state.parsed.domain, 'rubric');
  const rubric = await generateJSON<Rubric>(
    buildGenerateRubricPrompt(ctx.state.parsed, exemplars),
  );
  return {
    public: rubric,
    stateUpdate: { rubric },
  };
}
