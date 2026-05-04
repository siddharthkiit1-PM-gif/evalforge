import { tool } from 'ai';
import { z } from 'zod';
import type { OrchestratorState, OrchToolName } from '@/lib/agent/types';
import { parseSpecTool } from '@/lib/agent/tools/parseSpec';
import { generateTestsTool } from '@/lib/agent/tools/generateTestsTool';
import { generateRubricTool } from '@/lib/agent/tools/generateRubricTool';
import { runEvalNowTool } from '@/lib/agent/tools/runEvalNow';
import { earlyStopTool } from '@/lib/agent/tools/earlyStop';
import { diagnoseFailures } from '@/lib/agent/tools/diagnose';
import { addTests } from '@/lib/agent/tools/addTests';
import { addAdversarialTests } from '@/lib/agent/tools/addAdversarial';
import { reviseRubric } from '@/lib/agent/tools/reviseRubric';
import { tightenRubricDescriptors } from '@/lib/agent/tools/tightenDescriptors';
import { rewriteTest } from '@/lib/agent/tools/rewriteTest';

export type OrchToolHandlerResult<TPublic> = {
  public: TPublic;
  stateUpdate: Partial<OrchestratorState>;
};

export type OrchToolContext = {
  state: OrchestratorState;
  spec: string;
  signal?: AbortSignal;
};

// Adapt the orchestrator's optional state into the AgentToolContext that
// improver tools expect. Caller MUST guarantee pipeline state is populated.
function asAgentCtx(ctx: OrchToolContext) {
  if (!ctx.state.parsed || !ctx.state.tests || !ctx.state.rubric || !ctx.state.results || !ctx.state.summary) {
    throw new Error('improver tools require pipeline state to be complete');
  }
  return {
    state: {
      parsed: ctx.state.parsed,
      tests: ctx.state.tests,
      rubric: ctx.state.rubric,
      results: ctx.state.results,
      summary: ctx.state.summary,
    },
    signal: ctx.signal,
  };
}

function isPipelineComplete(state: OrchestratorState): boolean {
  return Boolean(state.parsed && state.tests && state.rubric && state.results && state.summary);
}

export function buildOrchestratorRegistry(ctx: OrchToolContext) {
  const pipelineDone = isPipelineComplete(ctx.state);

  const baseTools = {
    parse_spec: tool({
      description:
        'Parse the raw user spec into a structured ParsedSpec (feature, inputs, outputs, constraints, domain). Call this first.',
      inputSchema: z.object({}),
      execute: async () => parseSpecTool({ spec: ctx.spec }, ctx),
    }),
    generate_tests: tool({
      description:
        'Generate the initial 20-case test suite. Requires parse_spec first.',
      inputSchema: z.object({}),
      execute: async (args: Record<string, never>) => generateTestsTool(args, ctx),
    }),
    generate_rubric: tool({
      description:
        'Generate the initial scoring rubric. Requires parse_spec first.',
      inputSchema: z.object({}),
      execute: async (args: Record<string, never>) => generateRubricTool(args, ctx),
    }),
    run_eval_now: tool({
      description:
        'Run the full evaluation: judge every test against every rubric dimension. Requires parse_spec, generate_tests, and generate_rubric first. After this, improver tools become available.',
      inputSchema: z.object({}),
      execute: async (args: Record<string, never>) => runEvalNowTool(args, ctx),
    }),
    early_stop: tool({
      description:
        'Voluntarily stop the orchestration. Use when scores are good enough or further iteration would not help. Provide a short reason.',
      inputSchema: z.object({ reason: z.string() }),
      execute: async (args) => earlyStopTool(args, ctx),
    }),
  };

  if (!pipelineDone) {
    return baseTools;
  }

  // Improver tools — wrap the existing handlers so their `stateUpdate` shape
  // (Partial<AgentState>) lifts into the orchestrator's broader state.
  return {
    ...baseTools,
    diagnose_failures: tool({
      description:
        'Read-only. Analyze failed cases for one rubric dimension and return failure patterns + suggested actions.',
      inputSchema: z.object({ dimensionId: z.string() }),
      execute: async (args) => {
        const out = await diagnoseFailures(args, asAgentCtx(ctx));
        return { public: out.public, stateUpdate: out.stateUpdate };
      },
    }),
    add_tests: tool({
      description: 'Generate and append n new tests (1-10).',
      inputSchema: z.object({
        n: z.number().int().min(1).max(10),
        focusDimensionId: z.string().optional(),
      }),
      execute: async (args) => {
        const out = await addTests(args, asAgentCtx(ctx));
        return { public: out.public, stateUpdate: out.stateUpdate };
      },
    }),
    add_adversarial_tests: tool({
      description: 'Append 4 adversarial tests of the given category.',
      inputSchema: z.object({
        category: z.enum(['injection', 'edge-case', 'ambiguous-input', 'out-of-scope']),
      }),
      execute: async (args) => {
        const out = await addAdversarialTests(args, asAgentCtx(ctx));
        return { public: out.public, stateUpdate: out.stateUpdate };
      },
    }),
    revise_rubric: tool({
      description: 'Revise the entire rubric. Same dimension ids preserved.',
      inputSchema: z.object({ reason: z.string() }),
      execute: async (args) => {
        const out = await reviseRubric(args, asAgentCtx(ctx));
        return { public: out.public, stateUpdate: out.stateUpdate };
      },
    }),
    tighten_rubric_descriptors: tool({
      description:
        'Tighten the descriptor of one rubric dimension to make pass/fail more concrete.',
      inputSchema: z.object({ dimensionId: z.string() }),
      execute: async (args) => {
        const out = await tightenRubricDescriptors(args, asAgentCtx(ctx));
        return { public: out.public, stateUpdate: out.stateUpdate };
      },
    }),
    rewrite_test: tool({
      description: 'Rewrite one test case in place (id preserved).',
      inputSchema: z.object({ testId: z.string(), reason: z.string() }),
      execute: async (args) => {
        const out = await rewriteTest(args, asAgentCtx(ctx));
        return { public: out.public, stateUpdate: out.stateUpdate };
      },
    }),
  };
}

export const ORCH_TOOL_NAMES = [
  'parse_spec',
  'generate_tests',
  'generate_rubric',
  'run_eval_now',
  'early_stop',
  'diagnose_failures',
  'add_tests',
  'add_adversarial_tests',
  'revise_rubric',
  'tighten_rubric_descriptors',
  'rewrite_test',
] as const satisfies readonly OrchToolName[];
