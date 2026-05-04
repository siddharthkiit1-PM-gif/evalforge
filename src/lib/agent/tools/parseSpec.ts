import { generateJSON } from '@/lib/gemini';
import { buildParseSpecPrompt } from '@/lib/prompts';
import type { ParsedSpec } from '@/lib/types';
import type { OrchToolHandlerResult, OrchToolContext } from '@/lib/agent/orchestratorTools';

export type ParseSpecInput = { spec: string };
export type ParseSpecOutput = ParsedSpec;

export async function parseSpecTool(
  input: ParseSpecInput,
  _ctx: OrchToolContext,
): Promise<OrchToolHandlerResult<ParseSpecOutput>> {
  const parsed = await generateJSON<ParsedSpec>(buildParseSpecPrompt(input.spec.trim()));
  return {
    public: parsed,
    stateUpdate: { parsed },
  };
}
