import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentDiff from '@/components/AgentDiff';
import type { SnapshotDiff } from '@/lib/agent/types';

const DIFF: SnapshotDiff = {
  testsAdded: [{ id: 'test-21', category: 'adversarial', input: 'new adv' }],
  testsRemoved: [],
  testsChanged: [],
  rubricDimensionsChanged: [
    { id: 'redline', beforeDescriptor: 'vague', afterDescriptor: 'sharp', weightDelta: 0 },
  ],
  overallDelta: 0.18,
  perDimensionDelta: [{ id: 'redline', delta: 0.25 }],
};

describe('AgentDiff', () => {
  it('renders the overall delta', () => {
    render(<AgentDiff diff={DIFF} />);
    expect(screen.getByText(/\+0\.18/)).toBeTruthy();
  });

  it('lists added tests count and rubric changes', () => {
    render(<AgentDiff diff={DIFF} />);
    expect(screen.getByText(/1 test added/i)).toBeTruthy();
    expect(screen.getByText(/redline/)).toBeTruthy();
    expect(screen.getByText(/sharp/)).toBeTruthy();
  });
});
