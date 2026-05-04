import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { tightenRubricDescriptors } from '@/lib/agent/tools/tightenDescriptors';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'legal' },
  tests: [],
  rubric: {
    dimensions: [
      { id: 'redline', label: 'Redline', description: 'vague descriptor', weight: 0.5 },
      { id: 'risk', label: 'Risk', description: 'other', weight: 0.5 },
    ],
  },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: { redline: 0.4, risk: 0.8 } },
};

describe('tightenRubricDescriptors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates only the targeted dimension and returns before/after', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      description: 'a sharper, more specific descriptor',
    });
    const out = await tightenRubricDescriptors({ dimensionId: 'redline' }, { state: STATE });
    expect(out.public.before).toBe('vague descriptor');
    expect(out.public.after).toBe('a sharper, more specific descriptor');
    expect(out.stateUpdate.rubric?.dimensions.find((d) => d.id === 'redline')?.description).toBe(
      'a sharper, more specific descriptor',
    );
    expect(out.stateUpdate.rubric?.dimensions.find((d) => d.id === 'risk')?.description).toBe('other');
  });

  it('throws if the dimension id is unknown', async () => {
    await expect(
      tightenRubricDescriptors({ dimensionId: 'nonexistent' }, { state: STATE }),
    ).rejects.toThrow(/nonexistent/);
  });
});
