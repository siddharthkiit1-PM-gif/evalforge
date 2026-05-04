import { tool } from 'ai';
import { z } from 'zod';
import type { AgentState, ToolName } from '@/lib/agent/types';
import { diagnoseFailures } from '@/lib/agent/tools/diagnose';
import { addTests } from '@/lib/agent/tools/addTests';
import { addAdversarialTests } from '@/lib/agent/tools/addAdversarial';
import { reviseRubric } from '@/lib/agent/tools/reviseRubric';
import { tightenRubricDescriptors } from '@/lib/agent/tools/tightenDescriptors';
import { rewriteTest } from '@/lib/agent/tools/rewriteTest';
import { rerunEval } from '@/lib/agent/tools/rerunEval';

export const TOOL_NAMES = [
  'diagnose_failures',
  'add_tests',
  'add_adversarial_tests',
  'revise_rubric',
  'tighten_rubric_descriptors',
  'rewrite_test',
  'rerun_eval',
] as const satisfies readonly ToolName[];

export type ToolHandlerResult<TPublic> = {
  public: TPublic;
  stateUpdate: Partial<AgentState>;
};

export type AgentToolContext = {
  state: AgentState;
  signal?: AbortSignal;
};

// Build the AI-SDK tool registry bound to a specific agent context.
// The planner calls this once per iteration with the latest state.
export function buildToolRegistry(ctx: AgentToolContext) {
  return {
    diagnose_failures: tool({
      description:
        'Read-only. Analyze the failed cases for one rubric dimension and return common failure patterns plus suggested next actions.',
      inputSchema: z.object({ dimensionId: z.string() }),
      execute: async (args) => diagnoseFailures(args, ctx),
    }),
    add_tests: tool({
      description:
        'Generate and append n new test cases (1-10). Optionally focus on a specific rubric dimension.',
      inputSchema: z.object({
        n: z.number().int().min(1).max(10),
        focusDimensionId: z.string().optional(),
      }),
      execute: async (args) => addTests(args, ctx),
    }),
    add_adversarial_tests: tool({
      description:
        'Generate 4 adversarial test cases of a given category and append them to the test suite.',
      inputSchema: z.object({
        category: z.enum(['injection', 'edge-case', 'ambiguous-input', 'out-of-scope']),
      }),
      execute: async (args) => addAdversarialTests(args, ctx),
    }),
    revise_rubric: tool({
      description:
        'Revise the entire rubric (descriptions and weights) given a reason. Same dimension ids preserved.',
      inputSchema: z.object({ reason: z.string() }),
      execute: async (args) => reviseRubric(args, ctx),
    }),
    tighten_rubric_descriptors: tool({
      description:
        'Tighten the descriptor of a single rubric dimension to make pass/fail more concrete.',
      inputSchema: z.object({ dimensionId: z.string() }),
      execute: async (args) => tightenRubricDescriptors(args, ctx),
    }),
    rewrite_test: tool({
      description:
        'Rewrite one test case in place (id preserved) given a reason — typically because the current input is too soft or unclear.',
      inputSchema: z.object({ testId: z.string(), reason: z.string() }),
      execute: async (args) => rewriteTest(args, ctx),
    }),
    rerun_eval: tool({
      description:
        'Re-run the evaluation against the current tests + rubric. Always call this after a mutation before deciding the next action.',
      inputSchema: z.object({}),
      execute: async (args) => rerunEval(args, ctx),
    }),
  };
}
