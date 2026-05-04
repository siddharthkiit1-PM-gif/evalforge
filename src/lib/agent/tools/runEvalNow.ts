import { runEval } from '@/lib/runEval';
import type { EvalResult } from '@/lib/types';
import type { Summary } from '@/lib/scoring';
import type { OrchToolHandlerResult, OrchToolContext } from '@/lib/agent/orchestratorTools';

export type RunEvalNowInput = Record<string, never>;
export type RunEvalNowOutput = { results: EvalResult[]; summary: Summary };

export async function runEvalNowTool(
  _input: RunEvalNowInput,
  ctx: OrchToolContext,
): Promise<OrchToolHandlerResult<RunEvalNowOutput>> {
  if (!ctx.state.parsed || !ctx.state.tests || !ctx.state.rubric) {
    throw new Error(
      'run_eval_now requires parsed, tests, and rubric to be set first',
    );
  }
  const { results, summary } = await runEval(
    ctx.state.parsed,
    ctx.state.rubric,
    ctx.state.tests,
    { signal: ctx.signal },
  );
  return {
    public: { results, summary },
    stateUpdate: { results, summary },
  };
}
