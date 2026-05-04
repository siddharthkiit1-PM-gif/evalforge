import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { reviseRubric } from '@/lib/agent/tools/reviseRubric';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'legal' },
  tests: [],
  rubric: {
    dimensions: [
      { id: 'd1', label: 'D1', description: 'orig', weight: 0.5 },
      { id: 'd2', label: 'D2', description: 'orig', weight: 0.5 },
    ],
  },
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: { d1: 0.4, d2: 0.6 } },
};

describe('reviseRubric', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the revised rubric and lists changed dimension ids', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      dimensions: [
        { id: 'd1', label: 'D1', description: 'tighter', weight: 0.6 },
        { id: 'd2', label: 'D2', description: 'orig', weight: 0.4 },
      ],
    });
    const out = await reviseRubric({ reason: 'd1 too vague' }, { state: STATE });
    expect(out.public.changedDimensions.sort()).toEqual(['d1', 'd2']);
    expect(out.stateUpdate.rubric?.dimensions[0].description).toBe('tighter');
  });

  it('passes the reason to the prompt', async () => {
    const mock = generateJSON as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue({ dimensions: STATE.rubric.dimensions });
    await reviseRubric({ reason: 'specificity issue' }, { state: STATE });
    const prompt = mock.mock.calls[0][0] as string;
    expect(prompt).toContain('specificity issue');
  });

  it('reports no changes if the LLM returns the identical rubric', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      dimensions: STATE.rubric.dimensions,
    });
    const out = await reviseRubric({ reason: 'r' }, { state: STATE });
    expect(out.public.changedDimensions).toHaveLength(0);
  });
});
