import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { addAdversarialTests } from '@/lib/agent/tools/addAdversarial';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'healthcare' },
  tests: [{ id: 'test-01', category: 'happy_path', input: 'a' }],
  rubric: { dimensions: [{ id: 'd', label: 'D', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: {} },
};

describe('addAdversarialTests', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends 3-5 adversarial tests with continuing ids', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'x', category: 'adversarial', input: 'inj1' },
      { id: 'x', category: 'adversarial', input: 'inj2' },
      { id: 'x', category: 'adversarial', input: 'inj3' },
    ]);
    const out = await addAdversarialTests({ category: 'injection' }, { state: STATE });
    expect(out.public.added).toHaveLength(3);
    expect(out.public.added.every((t) => t.category === 'adversarial')).toBe(true);
    expect(out.public.added[0].id).toBe('test-02');
    expect(out.stateUpdate.tests).toHaveLength(4);
  });

  it('mentions the category in the prompt', async () => {
    const mock = generateJSON as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue([{ id: 'x', category: 'adversarial', input: 'q' }]);
    await addAdversarialTests({ category: 'out-of-scope' }, { state: STATE });
    const prompt = mock.mock.calls[0][0] as string;
    expect(prompt).toContain('out-of-scope');
  });
});
