import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TestSuiteTable from '@/components/TestSuiteTable';
import type { TestCase } from '@/lib/types';

const SAMPLE: TestCase[] = [
  { id: 'test-01', category: 'happy_path', input: 'a normal email' },
  { id: 'test-02', category: 'edge_case', input: 'an empty profile' },
  { id: 'test-03', category: 'adversarial', input: 'jailbreak attempt' },
];

describe('TestSuiteTable', () => {
  it('renders one row per test', () => {
    render(<TestSuiteTable tests={SAMPLE} />);
    expect(screen.getByText('test-01')).toBeInTheDocument();
    expect(screen.getByText('test-02')).toBeInTheDocument();
    expect(screen.getByText('test-03')).toBeInTheDocument();
  });

  it('renders the input text for each row', () => {
    render(<TestSuiteTable tests={SAMPLE} />);
    expect(screen.getByText('a normal email')).toBeInTheDocument();
    expect(screen.getByText('an empty profile')).toBeInTheDocument();
    expect(screen.getByText('jailbreak attempt')).toBeInTheDocument();
  });

  it('renders the category labels', () => {
    render(<TestSuiteTable tests={SAMPLE} />);
    expect(screen.getByText(/happy/i)).toBeInTheDocument();
    expect(screen.getByText(/edge/i)).toBeInTheDocument();
    expect(screen.getByText(/adversarial/i)).toBeInTheDocument();
  });

  it('renders an empty state when no tests', () => {
    render(<TestSuiteTable tests={[]} />);
    expect(screen.getByText(/no tests/i)).toBeInTheDocument();
  });
});
