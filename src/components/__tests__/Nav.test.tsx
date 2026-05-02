import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Nav from '@/components/Nav';

describe('Nav', () => {
  it('renders the EvalForge brand', () => {
    render(<Nav />);
    expect(screen.getByText('EvalForge')).toBeInTheDocument();
  });

  it('renders a "Built by Siddharth" link', () => {
    render(<Nav />);
    const link = screen.getByRole('link', { name: /built by siddharth/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href');
  });

  it('renders as a banner landmark', () => {
    render(<Nav />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
