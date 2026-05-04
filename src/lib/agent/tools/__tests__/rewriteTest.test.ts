import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { rewriteTest } from '@/lib/agent/tools/rewriteTest';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'legal' },
  tests: [
    { id: 'test-01', category: 'happy_path', input: 'orig' },
    { id: 'test-02', category: 'edge_case', input: 'keep' },
  ],
  rubric: { dimensions: [{ id: 'd', label: 'D', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: {} },
};

describe('rewriteTest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces the targeted test in place keeping the id', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      category: 'edge_case',
      input: 'rewritten input',
      notes: 'tighter',
    });
    const out = await rewriteTest({ testId: 'test-01', reason: 'too soft' }, { state: STATE });
    expect(out.public.before.input).toBe('orig');
    expect(out.public.after.input).toBe('rewritten input');
    expect(out.public.after.id).toBe('test-01');
    expect(out.stateUpdate.tests).toHaveLength(2);
    expect(out.stateUpdate.tests?.[0].id).toBe('test-01');
    expect(out.stateUpdate.tests?.[0].input).toBe('rewritten input');
    expect(out.stateUpdate.tests?.[1].input).toBe('keep');
  });

  it('throws if the test id is unknown', async () => {
    await expect(
      rewriteTest({ testId: 'test-99', reason: 'x' }, { state: STATE }),
    ).rejects.toThrow(/test-99/);
  });
});
