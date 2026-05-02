import { describe, it, expect } from 'vitest';
import { initialState, reducer } from '@/lib/pageReducer';
import type {
  Issue,
  ParsedSpec,
  Rubric,
  TestCase,
} from '@/lib/types';

const sampleParsed: ParsedSpec = {
  feature: 'F',
  inputs: ['i'],
  outputs: ['o'],
  constraints: ['c'],
  domain: 'general',
};

const sampleTests: TestCase[] = [
  { id: 'test-01', category: 'happy_path', input: 'x' },
];

const sampleRubric: Rubric = {
  dimensions: [{ id: 'a', label: 'A', description: 'd', weight: 1 }],
};

const majorIssue: Issue = {
  field: 'feature',
  severity: 'major',
  description: 'fix',
  suggestion: 'fix it',
};

describe('pageReducer', () => {
  it('starts in idle for every stage', () => {
    expect(initialState.stages.parse.phase).toBe('idle');
    expect(initialState.stages.tests.phase).toBe('idle');
    expect(initialState.stages.rubric.phase).toBe('idle');
    expect(initialState.error).toBeNull();
  });

  it('STAGE_START sets the named stage to generating with pass=0 and clears prior data', () => {
    const seed = reducer(initialState, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'done', output: sampleParsed },
    });
    const next = reducer(seed, { type: 'STAGE_START', stage: 'parse' });
    expect(next.stages.parse.phase).toBe('generating');
    expect(next.stages.parse.pass).toBe(0);
    expect(next.stages.parse.current).toBeNull();
    expect(next.stages.parse.issues).toEqual([]);
  });

  it('generated event stores current output and keeps phase as generating', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'generated', pass: 0, output: sampleParsed },
    });
    expect(next.stages.parse.phase).toBe('generating');
    expect(next.stages.parse.current).toEqual(sampleParsed);
    expect(next.stages.parse.pass).toBe(0);
  });

  it('critiquing event flips phase to critiquing and updates pass', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'critiquing', pass: 1 },
    });
    expect(next.stages.parse.phase).toBe('critiquing');
    expect(next.stages.parse.pass).toBe(1);
  });

  it('critiqued event stores issues; phase stays critiquing if any major issues', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'critiqued', pass: 1, issues: [majorIssue] },
    });
    expect(next.stages.parse.phase).toBe('critiquing');
    expect(next.stages.parse.issues).toEqual([majorIssue]);
  });

  it('critiqued event with no major issues moves phase to done-pending', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'critiqued', pass: 1, issues: [] },
    });
    expect(next.stages.parse.phase).toBe('done');
  });

  it('revising event flips phase to revising', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'tests' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'tests',
      event: { type: 'revising', pass: 1 },
    });
    expect(next.stages.tests.phase).toBe('revising');
    expect(next.stages.tests.pass).toBe(1);
  });

  it('revised event updates current output and pass; phase stays revising', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'tests' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'tests',
      event: { type: 'revised', pass: 1, output: sampleTests },
    });
    expect(next.stages.tests.current).toEqual(sampleTests);
    expect(next.stages.tests.pass).toBe(1);
    expect(next.stages.tests.phase).toBe('revising');
  });

  it('done event locks the stage with the final output', () => {
    const start = reducer(initialState, { type: 'STAGE_START', stage: 'rubric' });
    const next = reducer(start, {
      type: 'STAGE_EVENT',
      stage: 'rubric',
      event: { type: 'done', output: sampleRubric },
    });
    expect(next.stages.rubric.phase).toBe('done');
    expect(next.stages.rubric.current).toEqual(sampleRubric);
  });

  it('error event flips phase to error and sets root error', () => {
    const next = reducer(initialState, {
      type: 'STAGE_EVENT',
      stage: 'parse',
      event: { type: 'error', message: 'boom' },
    });
    expect(next.stages.parse.phase).toBe('error');
    expect(next.error).toEqual({ stage: 'parse', message: 'boom', recoverable: false });
  });

  it('STAGE_ERR sets root error and stage phase to error', () => {
    const next = reducer(initialState, {
      type: 'STAGE_ERR',
      stage: 'tests',
      message: 'network',
      recoverable: true,
    });
    expect(next.stages.tests.phase).toBe('error');
    expect(next.error).toEqual({ stage: 'tests', message: 'network', recoverable: true });
  });

  it('RESET returns initial state', () => {
    const dirty = reducer(initialState, { type: 'STAGE_START', stage: 'parse' });
    expect(reducer(dirty, { type: 'RESET' })).toEqual(initialState);
  });
});
