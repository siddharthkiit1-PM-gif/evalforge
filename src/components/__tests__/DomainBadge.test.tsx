import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DomainBadge from '@/components/DomainBadge';

describe('DomainBadge', () => {
  it('renders the legal label', () => {
    render(<DomainBadge domain="legal" />);
    expect(screen.getByText(/legal/i)).toBeInTheDocument();
  });

  it('renders the sales label', () => {
    render(<DomainBadge domain="sales" />);
    expect(screen.getByText(/sales/i)).toBeInTheDocument();
  });

  it('renders the healthcare label', () => {
    render(<DomainBadge domain="healthcare" />);
    expect(screen.getByText(/healthcare/i)).toBeInTheDocument();
  });

  it('renders the general label', () => {
    render(<DomainBadge domain="general" />);
    expect(screen.getByText(/general/i)).toBeInTheDocument();
  });
});
