import { describe, it, expect } from 'vitest';
import { weightedOverall, summarize } from '@/lib/scoring';
import type { Rubric, EvalResult } from '@/lib/types';

const rubric: Rubric = {
  dimensions: [
    { id: 'a', label: 'A', description: '', weight: 0.5 },
    { id: 'b', label: 'B', description: '', weight: 0.3 },
    { id: 'c', label: 'C', description: '', weight: 0.2 },
  ],
};

describe('weightedOverall', () => {
  it('computes weighted sum', () => {
    const overall = weightedOverall(
      [
        { dimensionId: 'a', score: 1, reasoning: '' },
        { dimensionId: 'b', score: 0.5, reasoning: '' },
        { dimensionId: 'c', score: 0, reasoning: '' },
      ],
      rubric,
    );
    expect(overall).toBeCloseTo(0.65, 5);
  });

  it('treats missing dimension as 0', () => {
    const overall = weightedOverall(
      [{ dimensionId: 'a', score: 1, reasoning: '' }],
      rubric,
    );
    expect(overall).toBeCloseTo(0.5, 5);
  });
});

describe('summarize', () => {
  const results: EvalResult[] = [
    { testId: 't1', output: 'x', passed: false, scores: [
      { dimensionId: 'a', score: 1, reasoning: '' },
      { dimensionId: 'b', score: 1, reasoning: '' },
      { dimensionId: 'c', score: 1, reasoning: '' },
    ]},
    { testId: 't2', output: 'x', passed: false, scores: [
      { dimensionId: 'a', score: 0, reasoning: '' },
      { dimensionId: 'b', score: 0, reasoning: '' },
      { dimensionId: 'c', score: 0, reasoning: '' },
    ]},
  ];

  it('overall is mean of per-test weighted overalls', () => {
    const s = summarize(results, rubric, 0.7);
    expect(s.overall).toBeCloseTo(0.5, 5);
  });

  it('passedCount uses threshold (inclusive)', () => {
    const s = summarize(results, rubric, 1.0);
    expect(s.passedCount).toBe(1);
  });

  it('perDimension is mean per dimension', () => {
    const s = summarize(results, rubric, 0.7);
    expect(s.perDimension.a).toBeCloseTo(0.5, 5);
    expect(s.perDimension.b).toBeCloseTo(0.5, 5);
    expect(s.perDimension.c).toBeCloseTo(0.5, 5);
  });

  it('returns Summary with the expected shape', () => {
    const s = summarize(results, rubric, 0.7);
    expect(s).toHaveProperty('overall');
    expect(s).toHaveProperty('passedCount');
    expect(s).toHaveProperty('perDimension');
  });
});
