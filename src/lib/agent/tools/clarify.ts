import type { OrchToolHandlerResult, OrchToolContext } from '@/lib/agent/orchestratorTools';
import type { PendingClarify } from '@/lib/agent/types';

export type ClarifyInput = { question: string };
export type ClarifyOutput = { paused: true; question: string };

// Calling this tool returns a stateUpdate that records `pendingClarify`.
// The orchestrator detects pendingClarify after the iteration and yields
// `orch-paused` instead of continuing the loop.
export async function clarifyTool(
  input: ClarifyInput,
  _ctx: OrchToolContext,
): Promise<OrchToolHandlerResult<ClarifyOutput>> {
  const pending: PendingClarify = {
    question: input.question,
    askedAt: Date.now(),
  };
  return {
    public: { paused: true, question: input.question },
    stateUpdate: { pendingClarify: pending },
  };
}
