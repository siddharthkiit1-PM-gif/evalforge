import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentPanel from '@/components/AgentPanel';
import type { ImproveStageState } from '@/lib/pageReducer';
import type { Snapshot, SnapshotDiff, AgentState } from '@/lib/agent/types';

const SNAP: Snapshot = {
  tests: [], rubric: { dimensions: [] }, results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: { d: 0.5 } },
};
const DIFF: SnapshotDiff = {
  testsAdded: [], testsRemoved: [], testsChanged: [], rubricDimensionsChanged: [],
  overallDelta: 0.2, perDimensionDelta: [],
};
const FINAL: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [], rubric: { dimensions: [] }, results: [],
  summary: { overall: 0.7, passedCount: 0, perDimension: { d: 0.7 } },
};

describe('AgentPanel', () => {
  it('shows Improve button in idle phase when shouldTrigger is true', () => {
    const onImprove = vi.fn();
    render(
      <AgentPanel
        state={{ phase: 'idle' }}
        triggerable
        onImprove={onImprove}
        onRestore={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /improve with agent/i }));
    expect(onImprove).toHaveBeenCalledOnce();
  });

  it('hides itself when not triggerable and idle', () => {
    const { container } = render(
      <AgentPanel state={{ phase: 'idle' }} triggerable={false} onImprove={() => {}} onRestore={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows transcript while running', () => {
    const state: ImproveStageState = {
      phase: 'running',
      events: [{ type: 'iteration-start', iteration: 1 }],
      snapshot: SNAP,
    };
    render(<AgentPanel state={state} triggerable onImprove={() => {}} onRestore={() => {}} />);
    expect(screen.getByText(/iter|thinking/i)).toBeTruthy();
  });

  it('shows diff and Restore button when committed', () => {
    const onRestore = vi.fn();
    const state: ImproveStageState = {
      phase: 'done-committed',
      events: [],
      snapshot: SNAP,
      finalState: FINAL,
      diff: DIFF,
    };
    render(<AgentPanel state={state} triggerable onImprove={() => {}} onRestore={onRestore} />);
    expect(screen.getByText(/\+0\.20/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /restore previous/i }));
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it('shows rollback banner when rolled-back', () => {
    const state: ImproveStageState = {
      phase: 'done-rolled-back',
      events: [],
      snapshot: SNAP,
      restored: SNAP,
    };
    render(<AgentPanel state={state} triggerable onImprove={() => {}} onRestore={() => {}} />);
    expect(screen.getByText(/regressed/i)).toBeTruthy();
  });

  it('shows error message when in error phase', () => {
    const state: ImproveStageState = { phase: 'error', events: [], snapshot: null, message: 'planner crashed' };
    render(<AgentPanel state={state} triggerable onImprove={() => {}} onRestore={() => {}} />);
    expect(screen.getByText(/planner crashed/)).toBeTruthy();
  });
});
