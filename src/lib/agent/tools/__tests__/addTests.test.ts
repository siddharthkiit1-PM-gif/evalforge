import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { addTests } from '@/lib/agent/tools/addTests';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: ['i'], outputs: ['o'], constraints: [], domain: 'legal' },
  tests: [
    { id: 'test-01', category: 'happy_path', input: 'a' },
    { id: 'test-05', category: 'edge_case', input: 'b' },
  ],
  rubric: { dimensions: [{ id: 'd1', label: 'D1', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: {} },
};

describe('addTests', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends generated tests with ids continuing from current max', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'will-be-replaced-1', category: 'edge_case', input: 'new1' },
      { id: 'will-be-replaced-2', category: 'adversarial', input: 'new2' },
    ]);
    const out = await addTests({ n: 2 }, { state: STATE });
    expect(out.public.added).toHaveLength(2);
    expect(out.public.added.map((t) => t.id)).toEqual(['test-06', 'test-07']);
    expect(out.stateUpdate.tests).toHaveLength(4);
    expect(out.stateUpdate.tests?.[2].input).toBe('new1');
  });

  it('clamps n to the 1-10 range and trims excess generated tests', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({ id: 'x', category: 'happy_path', input: `g${i}` })),
    );
    const out = await addTests({ n: 99 }, { state: STATE });
    expect(out.public.added).toHaveLength(10);
  });

  it('mentions the focusDimensionId in the prompt when provided', async () => {
    const mock = generateJSON as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue([{ id: 'x', category: 'edge_case', input: 'q' }]);
    await addTests({ n: 1, focusDimensionId: 'redline' }, { state: STATE });
    const prompt = mock.mock.calls[0][0] as string;
    expect(prompt).toContain('redline');
  });
});
