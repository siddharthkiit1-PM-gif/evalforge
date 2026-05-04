import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentTranscript from '@/components/AgentTranscript';
import type { AgentEvent, Snapshot, SnapshotDiff, AgentState } from '@/lib/agent/types';

const SNAP: Snapshot = {
  tests: [],
  rubric: { dimensions: [] },
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: {} },
};
const DIFF: SnapshotDiff = {
  testsAdded: [], testsRemoved: [], testsChanged: [], rubricDimensionsChanged: [],
  overallDelta: 0, perDimensionDelta: [],
};
const FINAL: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [], rubric: { dimensions: [] }, results: [],
  summary: { overall: 0.7, passedCount: 0, perDimension: {} },
};

const events: AgentEvent[] = [
  { type: 'started', snapshot: SNAP, threshold: 0.7, maxIterations: 5 },
  { type: 'iteration-start', iteration: 1 },
  { type: 'tool-call', iteration: 1, name: 'diagnose_failures', args: { dimensionId: 'redline' } },
  { type: 'tool-result', iteration: 1, name: 'diagnose_failures', result: { patterns: ['vague'], suggestedActions: [] } },
  { type: 'iteration-end', iteration: 1 },
  { type: 'loop-end', reason: 'all-pass', finalSummary: FINAL.summary },
  { type: 'committed', finalState: FINAL, diff: DIFF },
];

describe('AgentTranscript', () => {
  it('renders one row per tool call with iteration number and tool name', () => {
    render(<AgentTranscript events={events} />);
    expect(screen.getByText(/iter 1/i)).toBeTruthy();
    expect(screen.getByText(/diagnose_failures/)).toBeTruthy();
  });

  it('shows pending state for tool calls without a result yet', () => {
    const partial: AgentEvent[] = [
      { type: 'started', snapshot: SNAP, threshold: 0.7, maxIterations: 5 },
      { type: 'iteration-start', iteration: 1 },
      { type: 'tool-call', iteration: 1, name: 'add_tests', args: { n: 3 } },
    ];
    render(<AgentTranscript events={partial} />);
    expect(screen.getByText(/pending/i)).toBeTruthy();
  });
});
