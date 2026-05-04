import { describe, it, expect } from 'vitest';
import { shouldTrigger, shouldStop, weakestDimension } from '@/lib/agent/triggers';
import type { AgentIteration } from '@/lib/agent/types';
import type { Summary } from '@/lib/scoring';

const sum = (overall: number, perDimension: Record<string, number>): Summary => ({
  overall,
  passedCount: 0,
  perDimension,
});

const iter = (
  iteration: number,
  weakestDeltaSinceLast: number,
  summary: Summary,
): AgentIteration => ({
  iteration,
  toolName: 'rerun_eval',
  args: {},
  result: {},
  summaryAfter: summary,
  weakestDeltaSinceLast,
});

describe('shouldTrigger', () => {
  it('returns true when overall is below threshold', () => {
    expect(shouldTrigger(sum(0.5, { d1: 0.9, d2: 0.9 }), 0.7)).toBe(true);
  });
  it('returns true when any dimension is below threshold', () => {
    expect(shouldTrigger(sum(0.85, { d1: 0.6, d2: 0.95 }), 0.7)).toBe(true);
  });
  it('returns false when overall and all dimensions are at or above threshold', () => {
    expect(shouldTrigger(sum(0.8, { d1: 0.7, d2: 0.9 }), 0.7)).toBe(false);
  });
});

describe('weakestDimension', () => {
  it('returns the dimension with the lowest score', () => {
    expect(weakestDimension(sum(0.6, { a: 0.4, b: 0.7, c: 0.5 }))).toBe('a');
  });
  it('returns null for empty perDimension', () => {
    expect(weakestDimension(sum(0, {}))).toBeNull();
  });
});

describe('shouldStop', () => {
  it('returns "all-pass" when overall and every dimension >= threshold', () => {
    const history = [iter(1, 0, sum(0.85, { d1: 0.8, d2: 0.9 }))];
    expect(shouldStop(history, 0.7)).toBe('all-pass');
  });
  it('returns "iteration-cap" at 5 iterations', () => {
    const history = [
      iter(1, 0.1, sum(0.5, { d1: 0.4 })),
      iter(2, 0.1, sum(0.55, { d1: 0.45 })),
      iter(3, 0.1, sum(0.6, { d1: 0.5 })),
      iter(4, 0.1, sum(0.65, { d1: 0.55 })),
      iter(5, 0.1, sum(0.68, { d1: 0.58 })),
    ];
    expect(shouldStop(history, 0.7)).toBe('iteration-cap');
  });
  it('returns "no-improvement" when last 2 deltas are below 0.05', () => {
    const history = [
      iter(1, 0.0, sum(0.5, { d1: 0.4 })),
      iter(2, 0.06, sum(0.55, { d1: 0.46 })),
      iter(3, 0.02, sum(0.56, { d1: 0.48 })),
      iter(4, 0.01, sum(0.57, { d1: 0.49 })),
    ];
    expect(shouldStop(history, 0.7)).toBe('no-improvement');
  });
  it('returns null when only one iteration exists (cannot evaluate no-improvement)', () => {
    const history = [iter(1, 0, sum(0.6, { d1: 0.5 }))];
    expect(shouldStop(history, 0.7)).toBeNull();
  });
  it('returns null when most recent delta is large', () => {
    const history = [
      iter(1, 0.0, sum(0.5, { d1: 0.4 })),
      iter(2, 0.01, sum(0.51, { d1: 0.41 })),
      iter(3, 0.2, sum(0.6, { d1: 0.6 })),
    ];
    expect(shouldStop(history, 0.7)).toBeNull();
  });
  it('prefers all-pass over iteration-cap when both apply', () => {
    const history = [
      iter(1, 0, sum(0.5, { d1: 0.4 })),
      iter(2, 0.1, sum(0.6, { d1: 0.5 })),
      iter(3, 0.1, sum(0.7, { d1: 0.7 })),
      iter(4, 0.1, sum(0.8, { d1: 0.75 })),
      iter(5, 0.1, sum(0.9, { d1: 0.85 })),
    ];
    expect(shouldStop(history, 0.7)).toBe('all-pass');
  });
});
