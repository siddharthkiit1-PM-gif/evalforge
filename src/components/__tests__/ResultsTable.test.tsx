import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResultsTable from '@/components/ResultsTable';
import type { EvalResult, Rubric } from '@/lib/types';

const RUBRIC: Rubric = {
  dimensions: [{ id: 'a', label: 'A', description: '', weight: 1 }],
};

const RESULTS: EvalResult[] = [
  {
    testId: 't1',
    output: 'good',
    passed: true,
    scores: [{ dimensionId: 'a', score: 0.9, reasoning: 'why' }],
  },
];

describe('ResultsTable', () => {
  it('renders one row per result with output and pass/fail', () => {
    render(<ResultsTable results={RESULTS} rubric={RUBRIC} threshold={0.7} />);
    expect(screen.getByText('t1')).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
    expect(screen.getByText(/pass/i)).toBeInTheDocument();
  });

  it('expands row to show reasoning on click', async () => {
    render(<ResultsTable results={RESULTS} rubric={RUBRIC} threshold={0.7} />);
    await userEvent.click(screen.getByText('t1'));
    expect(screen.getByText('why')).toBeInTheDocument();
  });

  it('recomputes pass/fail from threshold rather than stored passed flag', () => {
    render(<ResultsTable results={RESULTS} rubric={RUBRIC} threshold={0.95} />);
    expect(screen.getByText(/fail/i)).toBeInTheDocument();
  });
});
