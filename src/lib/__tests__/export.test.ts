import { describe, it, expect } from 'vitest';
import { toBundleJSON, toResultsJSON, toCSV } from '@/lib/export';
import type { ParsedSpec, Rubric, TestCase, EvalResult } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

const spec = 'do the thing';
const parsed: ParsedSpec = { feature: 'f', domain: 'general', inputs: [], outputs: [], constraints: [] };
const rubric: Rubric = { dimensions: [
  { id: 'a', label: 'A', description: '', weight: 0.5 },
  { id: 'b', label: 'B', description: '', weight: 0.5 },
]};
const tests: TestCase[] = [{ id: 't1', category: 'happy_path', input: 'in' }];
const results: EvalResult[] = [
  { testId: 't1', output: 'o', passed: true, scores: [
    { dimensionId: 'a', score: 0.8, reasoning: 'good' },
    { dimensionId: 'b', score: 0.6, reasoning: 'has "quote", and\nnewline' },
  ]},
];
const summary: Summary = { overall: 0.7, passedCount: 1, perDimension: { a: 0.8, b: 0.6 } };

describe('toBundleJSON', () => {
  it('includes spec, parsed, tests, rubric, results, summary', () => {
    const obj = JSON.parse(toBundleJSON({ spec, parsed, tests, rubric, results, summary }));
    expect(obj.spec).toBe(spec);
    expect(obj.parsed).toEqual(parsed);
    expect(obj.tests).toEqual(tests);
    expect(obj.rubric).toEqual(rubric);
    expect(obj.results).toEqual(results);
    expect(obj.summary).toEqual(summary);
  });
});

describe('toResultsJSON', () => {
  it('returns just the results array', () => {
    const arr = JSON.parse(toResultsJSON(results));
    expect(arr).toEqual(results);
  });
});

describe('toCSV', () => {
  it('emits header row with per-dimension score and reasoning columns', () => {
    const csv = toCSV(results, rubric);
    const header = csv.split('\r\n')[0];
    expect(header).toBe('testId,output,passed,a_score,a_reasoning,b_score,b_reasoning');
  });

  it('escapes quotes (RFC 4180) and newlines in reasoning', () => {
    const csv = toCSV(results, rubric);
    expect(csv).toContain('"has ""quote"", and\nnewline"');
  });

  it('emits one data row per result', () => {
    const csv = toCSV(results, rubric);
    expect(csv.trim().split('\r\n').length).toBe(2); // header + 1
  });

  it('handles empty results array (header only)', () => {
    const csv = toCSV([], rubric);
    expect(csv).toBe('testId,output,passed,a_score,a_reasoning,b_score,b_reasoning');
  });
});
