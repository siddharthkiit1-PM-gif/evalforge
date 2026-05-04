import { describe, it, expect } from 'vitest';
import { clarifyTool } from '@/lib/agent/tools/clarify';
import type { OrchToolContext } from '@/lib/agent/orchestratorTools';
import type { OrchestratorState } from '@/lib/agent/types';

function ctx(): OrchToolContext {
  const state: OrchestratorState = {
    spec: 's',
    history: [],
    clarifications: [],
    budget: {
      capTokens: 100,
      capIterations: 10,
      capScoreThreshold: 0.8,
      spentTokens: 0,
      iterations: 0,
    },
  };
  return { state, spec: 's' };
}

describe('clarifyTool', () => {
  it('echoes the question in public output and marks paused', async () => {
    const before = Date.now();
    const out = await clarifyTool({ question: 'which domain?' }, ctx());
    const after = Date.now();

    expect(out.public).toEqual({ paused: true, question: 'which domain?' });
    expect(out.stateUpdate.pendingClarify?.question).toBe('which domain?');
    const askedAt = out.stateUpdate.pendingClarify!.askedAt;
    expect(askedAt).toBeGreaterThanOrEqual(before);
    expect(askedAt).toBeLessThanOrEqual(after);
  });

  it('returns only pendingClarify in stateUpdate (no other writes)', async () => {
    const out = await clarifyTool({ question: 'q' }, ctx());
    expect(Object.keys(out.stateUpdate)).toEqual(['pendingClarify']);
  });
});
