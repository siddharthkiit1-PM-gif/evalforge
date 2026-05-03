import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EvalProgress from '@/components/EvalProgress';

describe('EvalProgress', () => {
  it('renders completed/total and percentage', () => {
    render(<EvalProgress completed={5} total={20} />);
    expect(screen.getByText(/5\s*\/\s*20/)).toBeInTheDocument();
    expect(screen.getByText(/25%/)).toBeInTheDocument();
  });
});
