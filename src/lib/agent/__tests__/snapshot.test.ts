import { describe, it, expect } from 'vitest';
import { takeSnapshot, restoreSnapshot, diffSnapshots } from '@/lib/agent/snapshot';
import type { AgentState, Snapshot } from '@/lib/agent/types';

const baseState = (): AgentState => ({
  parsed: { feature: 'f', inputs: ['i'], outputs: ['o'], constraints: [], domain: 'legal' },
  tests: [
    { id: 'test-01', category: 'happy_path', input: 'a' },
    { id: 'test-02', category: 'edge_case', input: 'b' },
  ],
  rubric: {
    dimensions: [
      { id: 'd1', label: 'D1', description: 'orig', weight: 0.6 },
      { id: 'd2', label: 'D2', description: 'orig', weight: 0.4 },
    ],
  },
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: { d1: 0.4, d2: 0.7 } },
});

describe('takeSnapshot', () => {
  it('deep-clones state — mutating original does not affect snapshot', () => {
    const s = baseState();
    const snap = takeSnapshot(s);
    s.tests.push({ id: 'test-03', category: 'happy_path', input: 'c' });
    s.rubric.dimensions[0].description = 'changed';
    expect(snap.tests).toHaveLength(2);
    expect(snap.rubric.dimensions[0].description).toBe('orig');
  });
});

describe('restoreSnapshot', () => {
  it('returns a fresh clone — mutating return does not affect snapshot', () => {
    const snap: Snapshot = takeSnapshot(baseState());
    const restored = restoreSnapshot(snap);
    restored.tests.push({ id: 'test-99', category: 'happy_path', input: 'x' });
    expect(snap.tests).toHaveLength(2);
  });
});

describe('diffSnapshots', () => {
  it('detects added tests', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.tests.push({ id: 'test-03', category: 'adversarial', input: 'new' });
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.testsAdded).toHaveLength(1);
    expect(diff.testsAdded[0].id).toBe('test-03');
    expect(diff.testsChanged).toHaveLength(0);
  });

  it('detects changed tests by id', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.tests[0] = { id: 'test-01', category: 'happy_path', input: 'rewritten' };
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.testsChanged).toHaveLength(1);
    expect(diff.testsChanged[0].after.input).toBe('rewritten');
    expect(diff.testsAdded).toHaveLength(0);
  });

  it('detects rubric descriptor changes and weight deltas', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.rubric.dimensions[0].description = 'tighter wording';
    afterState.rubric.dimensions[0].weight = 0.7;
    afterState.rubric.dimensions[1].weight = 0.3;
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.rubricDimensionsChanged).toHaveLength(2);
    const d1 = diff.rubricDimensionsChanged.find((r) => r.id === 'd1')!;
    expect(d1.beforeDescriptor).toBe('orig');
    expect(d1.afterDescriptor).toBe('tighter wording');
    expect(d1.weightDelta).toBeCloseTo(0.1, 5);
  });

  it('computes overall and per-dimension score deltas', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.summary = { overall: 0.75, passedCount: 14, perDimension: { d1: 0.8, d2: 0.7 } };
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.overallDelta).toBeCloseTo(0.25, 5);
    const d1 = diff.perDimensionDelta.find((p) => p.id === 'd1')!;
    expect(d1.delta).toBeCloseTo(0.4, 5);
  });

  it('handles tests removed from after', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.tests = afterState.tests.filter((t) => t.id !== 'test-02');
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.testsRemoved).toHaveLength(1);
    expect(diff.testsRemoved[0].id).toBe('test-02');
  });
});
