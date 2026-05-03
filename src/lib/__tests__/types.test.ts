import { describe, it, expect } from 'vitest';
import type { RunSnapshot, RunEvent } from '@/lib/types';

describe('RunSnapshot', () => {
  it('admits the progress and done variants', () => {
    const a: RunSnapshot = { kind: 'progress', completed: 5, total: 20, partialResults: [] };
    const b: RunSnapshot = { kind: 'done', results: [], summary: { overall: 0, passedCount: 0, perDimension: {} } };
    expect(a.kind).toBe('progress');
    expect(b.kind).toBe('done');
  });
});

describe('RunEvent', () => {
  it('admits started, progress, done, error variants', () => {
    const ev1: RunEvent = { type: 'started', total: 20 };
    const ev2: RunEvent = { type: 'progress', completed: 5, total: 20, partialResults: [] };
    const ev3: RunEvent = { type: 'done', results: [], summary: { overall: 0, passedCount: 0, perDimension: {} } };
    const ev4: RunEvent = { type: 'error', message: 'x' };
    expect([ev1, ev2, ev3, ev4]).toHaveLength(4);
  });
});
