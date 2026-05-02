import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Footer from '@/components/Footer';

describe('Footer', () => {
  it('renders as a contentinfo landmark', () => {
    render(<Footer />);
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('renders the EvalForge byline', () => {
    render(<Footer />);
    expect(screen.getByText(/evalforge/i)).toBeInTheDocument();
  });
});
