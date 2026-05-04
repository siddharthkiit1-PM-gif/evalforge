import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { diagnoseFailures } from '@/lib/agent/tools/diagnose';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'legal' },
  tests: [
    { id: 'test-01', category: 'happy_path', input: 'a' },
    { id: 'test-02', category: 'edge_case', input: 'b' },
  ],
  rubric: {
    dimensions: [{ id: 'redline', label: 'Redline', description: 'desc', weight: 1.0 }],
  },
  results: [
    {
      testId: 'test-01',
      output: 'too vague',
      passed: false,
      scores: [{ dimensionId: 'redline', score: 0.3, reasoning: 'lacks specificity' }],
    },
    {
      testId: 'test-02',
      output: 'fine',
      passed: true,
      scores: [{ dimensionId: 'redline', score: 0.9, reasoning: 'good' }],
    },
  ],
  summary: { overall: 0.6, passedCount: 1, perDimension: { redline: 0.6 } },
};

describe('diagnoseFailures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns patterns and suggestions; does not mutate state', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      patterns: ['outputs lack specific clause references'],
      suggestedActions: ['tighten redline descriptor', 'add adversarial vague-redline tests'],
    });
    const out = await diagnoseFailures({ dimensionId: 'redline' }, { state: STATE });
    expect(out.public.patterns).toHaveLength(1);
    expect(out.public.suggestedActions).toHaveLength(2);
    expect(out.stateUpdate).toEqual({});
  });

  it('only sends failed cases for the target dimension to the LLM', async () => {
    const mock = generateJSON as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue({ patterns: [], suggestedActions: [] });
    await diagnoseFailures({ dimensionId: 'redline' }, { state: STATE });
    const prompt = mock.mock.calls[0][0] as string;
    expect(prompt).toContain('test-01');
    expect(prompt).not.toContain('test-02');
  });
});
