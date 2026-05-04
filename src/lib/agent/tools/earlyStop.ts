import type { OrchToolHandlerResult, OrchToolContext } from '@/lib/agent/orchestratorTools';

export type EarlyStopInput = { reason: string };
export type EarlyStopOutput = { stopped: true; reason: string };

export async function earlyStopTool(
  input: EarlyStopInput,
  _ctx: OrchToolContext,
): Promise<OrchToolHandlerResult<EarlyStopOutput>> {
  return {
    public: { stopped: true, reason: input.reason },
    stateUpdate: { earlyStopReason: input.reason },
  };
}
