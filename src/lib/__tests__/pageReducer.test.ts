import { describe, it, expect } from 'vitest';
import { initialState, reducer } from '@/lib/pageReducer';
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

const PARSED: ParsedSpec = {
  feature: 'F',
  inputs: ['i'],
  outputs: ['o'],
  constraints: ['c'],
  domain: 'sales',
};

const TESTS: TestCase[] = [
  { id: 'test-01', category: 'happy_path', input: 'in' },
];

const RUBRIC: Rubric = {
  dimensions: [{ id: 'a', label: 'A', description: 'd', weight: 1 }],
};

describe('pageReducer', () => {
  it('starts in idle state', () => {
    expect(initialState.status).toBe('idle');
  });

  it('PARSE_STARTED → parsing', () => {
    const s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'hello' });
    expect(s.status).toBe('parsing');
    expect(s.spec).toBe('hello');
    expect(s.error).toBeNull();
  });

  it('PARSE_SUCCEEDED → tests_generating, stores parsed', () => {
    const a = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    const b = reducer(a, { type: 'PARSE_SUCCEEDED', parsed: PARSED });
    expect(b.status).toBe('tests_generating');
    expect(b.parsed).toEqual(PARSED);
  });

  it('TESTS_SUCCEEDED → rubric_generating, stores tests', () => {
    let s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    s = reducer(s, { type: 'PARSE_SUCCEEDED', parsed: PARSED });
    s = reducer(s, { type: 'TESTS_SUCCEEDED', tests: TESTS });
    expect(s.status).toBe('rubric_generating');
    expect(s.tests).toEqual(TESTS);
  });

  it('RUBRIC_SUCCEEDED → ready, stores rubric', () => {
    let s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    s = reducer(s, { type: 'PARSE_SUCCEEDED', parsed: PARSED });
    s = reducer(s, { type: 'TESTS_SUCCEEDED', tests: TESTS });
    s = reducer(s, { type: 'RUBRIC_SUCCEEDED', rubric: RUBRIC });
    expect(s.status).toBe('ready');
    expect(s.rubric).toEqual(RUBRIC);
  });

  it('FAILED → error, stores message', () => {
    let s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    s = reducer(s, { type: 'FAILED', error: 'boom' });
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
  });

  it('RESET → back to idle', () => {
    let s = reducer(initialState, { type: 'PARSE_STARTED', spec: 'x' });
    s = reducer(s, { type: 'PARSE_SUCCEEDED', parsed: PARSED });
    s = reducer(s, { type: 'RESET' });
    expect(s).toEqual(initialState);
  });
});
