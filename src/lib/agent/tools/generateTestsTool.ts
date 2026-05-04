import { generateJSON } from '@/lib/gemini';
import { selectExemplars } from '@/lib/exemplars';
import { buildGenerateTestsPrompt } from '@/lib/prompts';
import type { TestCase } from '@/lib/types';
import type { OrchToolHandlerResult, OrchToolContext } from '@/lib/agent/orchestratorTools';

export type GenerateTestsInput = Record<string, never>;
export type GenerateTestsOutput = { tests: TestCase[] };

export async function generateTestsTool(
  _input: GenerateTestsInput,
  ctx: OrchToolContext,
): Promise<OrchToolHandlerResult<GenerateTestsOutput>> {
  if (!ctx.state.parsed) {
    throw new Error('generate_tests requires parsed spec; call parse_spec first');
  }
  const exemplars = selectExemplars(ctx.state.parsed.domain, 'tests');
  const result = await generateJSON<TestCase[] | { tests: TestCase[] }>(
    buildGenerateTestsPrompt(ctx.state.parsed, exemplars),
  );
  const tests = Array.isArray(result) ? result : result.tests;
  return {
    public: { tests },
    stateUpdate: { tests },
  };
}
