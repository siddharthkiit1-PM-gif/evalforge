import { describe, it, expect } from 'vitest';
import type {
  AgentEvent,
  AgentState,
  Snapshot,
  SnapshotDiff,
  AgentIteration,
  StopReason,
  ToolName,
  StateUpdate,
} from '@/lib/agent/types';

describe('agent types', () => {
  it('AgentEvent discriminated union compiles for all variants', () => {
    const events: AgentEvent[] = [
      { type: 'started', snapshot: {} as Snapshot, threshold: 0.7, maxIterations: 5 },
      { type: 'iteration-start', iteration: 1 },
      { type: 'planner-thinking', iteration: 1 },
      { type: 'tool-call', iteration: 1, name: 'diagnose_failures', args: {} },
      { type: 'tool-result', iteration: 1, name: 'diagnose_failures', result: {} },
      { type: 'iteration-end', iteration: 1 },
      { type: 'loop-end', reason: 'all-pass', finalSummary: { overall: 0.9, passedCount: 18, perDimension: {} } },
      { type: 'committed', finalState: {} as AgentState, diff: {} as SnapshotDiff },
      { type: 'rolled-back', reason: 'overall-regressed', restored: {} as Snapshot },
      { type: 'aborted' },
      { type: 'error', message: 'boom' },
    ];
    expect(events).toHaveLength(11);
  });

  it('StopReason union compiles for the three reasons', () => {
    const reasons: StopReason[] = ['all-pass', 'iteration-cap', 'no-improvement'];
    expect(reasons).toHaveLength(3);
  });

  it('ToolName union covers the seven tools', () => {
    const tools: ToolName[] = [
      'diagnose_failures',
      'add_tests',
      'add_adversarial_tests',
      'revise_rubric',
      'tighten_rubric_descriptors',
      'rewrite_test',
      'rerun_eval',
    ];
    expect(tools).toHaveLength(7);
  });

  it('StateUpdate is a partial of AgentState', () => {
    const u: StateUpdate = { tests: [] };
    expect(u).toBeDefined();
  });
});
