import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/runEval', () => ({ runEval: vi.fn() }));

import { runEval } from '@/lib/runEval';
import { rerunEval } from '@/lib/agent/tools/rerunEval';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [{ id: 'test-01', category: 'happy_path', input: 'a' }],
  rubric: { dimensions: [{ id: 'd', label: 'D', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: {} },
};

describe('rerunEval', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls runEval with current parsed/rubric/tests and returns results+summary', async () => {
    const fakeResults = [{ testId: 'test-01', output: 'o', scores: [], passed: true }];
    const fakeSummary = { overall: 0.85, passedCount: 1, perDimension: { d: 0.9 } };
    (runEval as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: fakeResults,
      summary: fakeSummary,
    });
    const out = await rerunEval({}, { state: STATE });
    expect(runEval).toHaveBeenCalledWith(STATE.parsed, STATE.rubric, STATE.tests, expect.any(Object));
    expect(out.public.results).toBe(fakeResults);
    expect(out.public.summary).toBe(fakeSummary);
    expect(out.stateUpdate.results).toBe(fakeResults);
    expect(out.stateUpdate.summary).toBe(fakeSummary);
  });

  it('forwards the abort signal from context', async () => {
    const ac = new AbortController();
    (runEval as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [],
      summary: { overall: 0, passedCount: 0, perDimension: {} },
    });
    await rerunEval({}, { state: STATE, signal: ac.signal });
    const opts = (runEval as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(opts.signal).toBe(ac.signal);
  });
});
