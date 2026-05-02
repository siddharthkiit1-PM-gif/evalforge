import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RubricPanel from '@/components/RubricPanel';
import type { Rubric } from '@/lib/types';

const RUBRIC: Rubric = {
  dimensions: [
    { id: 'personalization', label: 'Personalization', description: 'Refers to a specific profile detail.', weight: 0.5 },
    { id: 'concision', label: 'Concision', description: 'Stays under 150 words.', weight: 0.5 },
  ],
};

describe('RubricPanel', () => {
  it('renders each dimension label', () => {
    render(<RubricPanel rubric={RUBRIC} />);
    expect(screen.getByText('Personalization')).toBeInTheDocument();
    expect(screen.getByText('Concision')).toBeInTheDocument();
  });

  it('renders each dimension description', () => {
    render(<RubricPanel rubric={RUBRIC} />);
    expect(screen.getByText(/profile detail/i)).toBeInTheDocument();
    expect(screen.getByText(/150 words/i)).toBeInTheDocument();
  });

  it('renders each weight as a percentage', () => {
    render(<RubricPanel rubric={RUBRIC} />);
    const fifties = screen.getAllByText(/50%/);
    expect(fifties.length).toBeGreaterThanOrEqual(2);
  });

  it('renders an empty state when there are no dimensions', () => {
    render(<RubricPanel rubric={{ dimensions: [] }} />);
    expect(screen.getByText(/no rubric/i)).toBeInTheDocument();
  });
});
