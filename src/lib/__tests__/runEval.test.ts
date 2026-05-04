import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { generateJSON } from '@/lib/gemini';
import { runEval } from '@/lib/runEval';
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

const PARSED: ParsedSpec = {
  feature: 'f',
  inputs: [],
  outputs: [],
  constraints: [],
  domain: 'general',
};

const RUBRIC: Rubric = {
  dimensions: [
    { id: 'd1', label: 'D1', description: '', weight: 0.5 },
    { id: 'd2', label: 'D2', description: '', weight: 0.5 },
  ],
};

const TESTS: TestCase[] = [
  { id: 'test-01', category: 'happy_path', input: 'a' },
  { id: 'test-02', category: 'happy_path', input: 'b' },
];

describe('runEval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns results and a Summary for the given tests', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: 'ok',
      scores: [
        { dimensionId: 'd1', score: 0.9, reasoning: '' },
        { dimensionId: 'd2', score: 0.8, reasoning: '' },
      ],
    });
    const { results, summary } = await runEval(PARSED, RUBRIC, TESTS);
    expect(results).toHaveLength(2);
    expect(results[0].testId).toBe('test-01');
    expect(results[0].passed).toBe(true);
    expect(summary.overall).toBeCloseTo(0.85, 5);
    expect(summary.perDimension.d1).toBeCloseTo(0.9, 5);
  });

  it('substitutes empty results for tests that throw', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        output: 'ok',
        scores: [
          { dimensionId: 'd1', score: 0.9, reasoning: '' },
          { dimensionId: 'd2', score: 0.9, reasoning: '' },
        ],
      })
      .mockRejectedValueOnce(new Error('boom'));
    const { results, summary } = await runEval(PARSED, RUBRIC, TESTS);
    expect(results).toHaveLength(2);
    expect(results[1].output).toBe('');
    expect(results[1].passed).toBe(false);
    expect(summary).toBeDefined();
  });

  it('respects abort signal via runBatched', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runEval(PARSED, RUBRIC, TESTS, { signal: ac.signal })).rejects.toBeDefined();
  });
});
