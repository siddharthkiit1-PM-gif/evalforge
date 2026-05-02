import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

export type PageStatus =
  | 'idle'
  | 'parsing'
  | 'tests_generating'
  | 'rubric_generating'
  | 'ready'
  | 'error';

export type PageState = {
  status: PageStatus;
  spec: string;
  parsed: ParsedSpec | null;
  tests: TestCase[] | null;
  rubric: Rubric | null;
  error: string | null;
};

export type PageAction =
  | { type: 'PARSE_STARTED'; spec: string }
  | { type: 'PARSE_SUCCEEDED'; parsed: ParsedSpec }
  | { type: 'TESTS_STARTED' }
  | { type: 'TESTS_SUCCEEDED'; tests: TestCase[] }
  | { type: 'RUBRIC_STARTED' }
  | { type: 'RUBRIC_SUCCEEDED'; rubric: Rubric }
  | { type: 'FAILED'; error: string }
  | { type: 'RESET' };

export const initialState: PageState = {
  status: 'idle',
  spec: '',
  parsed: null,
  tests: null,
  rubric: null,
  error: null,
};

export function reducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case 'PARSE_STARTED':
      return {
        ...initialState,
        status: 'parsing',
        spec: action.spec,
      };
    case 'PARSE_SUCCEEDED':
      return {
        ...state,
        status: 'tests_generating',
        parsed: action.parsed,
      };
    case 'TESTS_STARTED':
      return { ...state, status: 'tests_generating' };
    case 'TESTS_SUCCEEDED':
      return {
        ...state,
        status: 'rubric_generating',
        tests: action.tests,
      };
    case 'RUBRIC_STARTED':
      return { ...state, status: 'rubric_generating' };
    case 'RUBRIC_SUCCEEDED':
      return {
        ...state,
        status: 'ready',
        rubric: action.rubric,
      };
    case 'FAILED':
      return { ...state, status: 'error', error: action.error };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}
