import type { EvalResult, EvalScore, Rubric } from '@/lib/types';

export function weightedOverall(scores: EvalScore[], rubric: Rubric): number {
  const byId = new Map(scores.map((s) => [s.dimensionId, s.score]));
  let total = 0;
  for (const dim of rubric.dimensions) {
    total += (byId.get(dim.id) ?? 0) * dim.weight;
  }
  return total;
}

export type Summary = {
  overall: number;
  passedCount: number;
  perDimension: Record<string, number>;
};

export function summarize(
  results: EvalResult[],
  rubric: Rubric,
  threshold: number,
): Summary {
  const overalls = results.map((r) => weightedOverall(r.scores, rubric));
  const overall = overalls.reduce((a, b) => a + b, 0) / Math.max(1, overalls.length);
  const passedCount = overalls.filter((o) => o >= threshold).length;
  const perDimension: Record<string, number> = {};
  for (const dim of rubric.dimensions) {
    const sum = results.reduce((acc, r) => {
      const score = r.scores.find((s) => s.dimensionId === dim.id)?.score ?? 0;
      return acc + score;
    }, 0);
    perDimension[dim.id] = sum / Math.max(1, results.length);
  }
  return { overall, passedCount, perDimension };
}
