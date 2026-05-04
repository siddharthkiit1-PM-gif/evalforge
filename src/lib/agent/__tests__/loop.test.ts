import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agent/planner', () => ({ callPlanner: vi.fn() }));

import { callPlanner } from '@/lib/agent/planner';
import { runAgentLoop } from '@/lib/agent/loop';
import type { AgentEvent, AgentState } from '@/lib/agent/types';

const baseState = (overall: number, perDim: Record<string, number>): AgentState => ({
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [{ id: 'test-01', category: 'happy_path', input: 'a' }],
  rubric: { dimensions: [{ id: 'd1', label: 'D1', description: '', weight: 1 }] },
  results: [],
  summary: { overall, passedCount: 0, perDimension: perDim },
});

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('runAgentLoop', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits started, iteration events, loop-end, and committed for an all-pass run', async () => {
    (callPlanner as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolName: 'rerun_eval',
      args: {},
      public: { results: [], summary: { overall: 0.9, passedCount: 1, perDimension: { d1: 0.9 } } },
      stateUpdate: { results: [], summary: { overall: 0.9, passedCount: 1, perDimension: { d1: 0.9 } } },
    });
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.7, maxIterations: 5 },
        new AbortController().signal,
      ),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain('started');
    expect(types).toContain('iteration-start');
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types).toContain('iteration-end');
    expect(types).toContain('loop-end');
    expect(types).toContain('committed');
    const loopEnd = events.find((e) => e.type === 'loop-end')!;
    if (loopEnd.type === 'loop-end') expect(loopEnd.reason).toBe('all-pass');
  });

  it('emits rolled-back when final overall regresses below the snapshot', async () => {
    (callPlanner as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolName: 'rerun_eval',
      args: {},
      public: { results: [], summary: { overall: 0.3, passedCount: 0, perDimension: { d1: 0.3 } } },
      stateUpdate: { results: [], summary: { overall: 0.3, passedCount: 0, perDimension: { d1: 0.3 } } },
    });
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.7, maxIterations: 2 },
        new AbortController().signal,
      ),
    );
    expect(events.some((e) => e.type === 'rolled-back')).toBe(true);
    expect(events.some((e) => e.type === 'committed')).toBe(false);
  });

  it('stops at iteration cap when no all-pass and no no-improvement triggered', async () => {
    let i = 0;
    (callPlanner as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      i++;
      // 0.06 increment avoids FP rounding (0.6 - 0.55 = 0.04999... in IEEE 754)
      // and keeps overall < 0.99 at i=5 so all-pass doesn't fire before iteration-cap.
      const overall = 0.5 + i * 0.06;
      return {
        toolName: 'rerun_eval',
        args: {},
        public: {},
        stateUpdate: {
          summary: { overall, passedCount: 0, perDimension: { d1: overall } },
        },
      };
    });
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.99, maxIterations: 5 },
        new AbortController().signal,
      ),
    );
    const loopEnd = events.find((e) => e.type === 'loop-end');
    if (loopEnd?.type === 'loop-end') expect(loopEnd.reason).toBe('iteration-cap');
  });

  it('aborts cleanly when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.7, maxIterations: 5 },
        ac.signal,
      ),
    );
    expect(events.some((e) => e.type === 'aborted')).toBe(true);
  });

  it('emits error and exits if a tool throws', async () => {
    (callPlanner as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.7, maxIterations: 5 },
        new AbortController().signal,
      ),
    );
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.message).toMatch(/boom/);
  });
});
