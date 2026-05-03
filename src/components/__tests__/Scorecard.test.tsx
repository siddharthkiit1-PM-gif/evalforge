import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Scorecard from '@/components/Scorecard';
import type { EvalResult, Rubric, TestCase, ParsedSpec } from '@/lib/types';

const rubric: Rubric = {
  dimensions: [{ id: 'a', label: 'A', description: '', weight: 1 }],
};
const results: EvalResult[] = [
  {
    testId: 't1',
    output: 'x',
    passed: true,
    scores: [{ dimensionId: 'a', score: 0.9, reasoning: '' }],
  },
  {
    testId: 't2',
    output: 'x',
    passed: true,
    scores: [{ dimensionId: 'a', score: 0.4, reasoning: '' }],
  },
];
const parsed: ParsedSpec = {
  feature: 'f',
  inputs: [],
  outputs: [],
  constraints: [],
  domain: 'general',
};
const tests: TestCase[] = [];

describe('Scorecard', () => {
  it('renders headline overall and N of total passed', () => {
    render(
      <Scorecard
        results={results}
        rubric={rubric}
        spec=""
        parsed={parsed}
        tests={tests}
      />,
    );
    expect(screen.getByText(/0\.65|0\.6\d/)).toBeInTheDocument();
    expect(screen.getByText(/1\s*of\s*2/i)).toBeInTheDocument();
  });

  it('slider re-tags pass/fail without API call', () => {
    render(
      <Scorecard
        results={results}
        rubric={rubric}
        spec=""
        parsed={parsed}
        tests={tests}
      />,
    );
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '1' } });
    expect(screen.getByText(/0\s*of\s*2/i)).toBeInTheDocument();
  });
});
