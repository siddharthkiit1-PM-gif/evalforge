import { describe, it, expect } from 'vitest';
import { initialState, reducer } from '@/lib/pageReducer';
import type { AgentEvent, Snapshot, SnapshotDiff, AgentState } from '@/lib/agent/types';

const SNAP: Snapshot = {
  tests: [],
  rubric: { dimensions: [] },
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: {} },
};

const DIFF: SnapshotDiff = {
  testsAdded: [],
  testsRemoved: [],
  testsChanged: [],
  rubricDimensionsChanged: [],
  overallDelta: 0.2,
  perDimensionDelta: [],
};

const FINAL: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [],
  rubric: { dimensions: [] },
  results: [],
  summary: { overall: 0.7, passedCount: 0, perDimension: {} },
};

describe('improve stage in pageReducer', () => {
  it('starts in idle phase', () => {
    expect(initialState.stages.improve.phase).toBe('idle');
  });

  it('IMPROVE_START transitions to running and clears events', () => {
    const next = reducer(initialState, { type: 'IMPROVE_START' });
    expect(next.stages.improve.phase).toBe('running');
    if (next.stages.improve.phase === 'running') {
      expect(next.stages.improve.events).toEqual([]);
      expect(next.stages.improve.snapshot).toBeNull();
    }
  });

  it('IMPROVE_EVENT(started) records the snapshot', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const event: AgentEvent = { type: 'started', snapshot: SNAP, threshold: 0.7, maxIterations: 5 };
    const b = reducer(a, { type: 'IMPROVE_EVENT', event });
    if (b.stages.improve.phase === 'running') {
      expect(b.stages.improve.snapshot).toEqual(SNAP);
      expect(b.stages.improve.events).toHaveLength(1);
    }
  });

  it('IMPROVE_EVENT(committed) transitions to done-committed', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const event: AgentEvent = { type: 'committed', finalState: FINAL, diff: DIFF };
    const b = reducer(a, { type: 'IMPROVE_EVENT', event });
    expect(b.stages.improve.phase).toBe('done-committed');
    if (b.stages.improve.phase === 'done-committed') {
      expect(b.stages.improve.diff).toEqual(DIFF);
      expect(b.stages.improve.finalState).toEqual(FINAL);
    }
  });

  it('IMPROVE_EVENT(rolled-back) transitions to done-rolled-back', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const e1: AgentEvent = { type: 'started', snapshot: SNAP, threshold: 0.7, maxIterations: 5 };
    const b = reducer(a, { type: 'IMPROVE_EVENT', event: e1 });
    const e2: AgentEvent = { type: 'rolled-back', reason: 'overall-regressed', restored: SNAP };
    const c = reducer(b, { type: 'IMPROVE_EVENT', event: e2 });
    expect(c.stages.improve.phase).toBe('done-rolled-back');
    if (c.stages.improve.phase === 'done-rolled-back') {
      expect(c.stages.improve.restored).toEqual(SNAP);
    }
  });

  it('IMPROVE_EVENT(error) transitions to error and records the message', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const event: AgentEvent = { type: 'error', message: 'planner failed' };
    const b = reducer(a, { type: 'IMPROVE_EVENT', event });
    expect(b.stages.improve.phase).toBe('error');
    if (b.stages.improve.phase === 'error') expect(b.stages.improve.message).toBe('planner failed');
  });

  it('IMPROVE_RESET returns improve stage to idle', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const b = reducer(a, { type: 'IMPROVE_RESET' });
    expect(b.stages.improve.phase).toBe('idle');
  });
});
