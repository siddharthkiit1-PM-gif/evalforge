import { runEval } from '@/lib/runEval';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';
import type { EvalResult } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

export type RerunEvalInput = Record<string, never>;
export type RerunEvalOutput = { results: EvalResult[]; summary: Summary };

export async function rerunEval(
  _input: RerunEvalInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<RerunEvalOutput>> {
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
