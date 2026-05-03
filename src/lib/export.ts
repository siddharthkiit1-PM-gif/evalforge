import type { ParsedSpec, Rubric, TestCase, EvalResult } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

export type Bundle = {
  spec: string;
  parsed: ParsedSpec;
  tests: TestCase[];
  rubric: Rubric;
  results: EvalResult[];
  summary: Summary;
};

export function toBundleJSON(b: Bundle): string {
  return JSON.stringify(b, null, 2);
}

export function toResultsJSON(results: EvalResult[]): string {
  return JSON.stringify(results, null, 2);
}

function csvCell(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(results: EvalResult[], rubric: Rubric): string {
  const dimIds = rubric.dimensions.map((d) => d.id);
  const header = ['testId', 'output', 'passed', ...dimIds.flatMap((id) => [`${id}_score`, `${id}_reasoning`])];
  const rows = results.map((r) => {
    const row: (string | number | boolean)[] = [r.testId, r.output, r.passed];
    for (const id of dimIds) {
      const s = r.scores.find((x) => x.dimensionId === id);
      row.push(s?.score ?? 0, s?.reasoning ?? '');
    }
    return row.map(csvCell).join(',');
  });
  return [header.join(','), ...rows].join('\r\n');
}
