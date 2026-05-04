import type {
  Issue,
  ParsedSpec,
  RefinementEvent,
  Rubric,
  RunEvent,
  RunSnapshot,
  TestCase,
} from '@/lib/types';
import type { AgentEvent, AgentState, Snapshot, SnapshotDiff } from '@/lib/agent/types';

export type StagePhase =
  | 'idle'
  | 'generating'
  | 'critiquing'
  | 'revising'
  | 'done'
  | 'error';

export type StageState<T> = {
  phase: StagePhase;
  pass: 0 | 1 | 2;
  current: T | null;
  issues: Issue[];
};

export type ImproveStageState =
  | { phase: 'idle' }
  | { phase: 'running'; events: AgentEvent[]; snapshot: Snapshot | null }
  | { phase: 'done-committed'; events: AgentEvent[]; snapshot: Snapshot; finalState: AgentState; diff: SnapshotDiff }
  | { phase: 'done-rolled-back'; events: AgentEvent[]; snapshot: Snapshot; restored: Snapshot }
  | { phase: 'error'; events: AgentEvent[]; snapshot: Snapshot | null; message: string };

export type StageKey = 'parse' | 'tests' | 'rubric' | 'run' | 'improve';

export type PageState = {
  spec: string;
  stages: {
    parse: StageState<ParsedSpec>;
    tests: StageState<TestCase[]>;
    rubric: StageState<Rubric>;
    run: StageState<RunSnapshot>;
    improve: ImproveStageState;
  };
  error: { stage: StageKey; message: string; recoverable: boolean } | null;
};

export type PageAction =
  | { type: 'STAGE_START'; stage: StageKey }
  | { type: 'STAGE_EVENT'; stage: StageKey; event: RefinementEvent<unknown> }
  | { type: 'STAGE_RUN_EVENT'; event: RunEvent }
  | { type: 'STAGE_ERR'; stage: StageKey; message: string; recoverable: boolean }
  | { type: 'PIPELINE_START'; spec: string }
  | { type: 'RESET' }
  | { type: 'IMPROVE_START' }
  | { type: 'IMPROVE_EVENT'; event: AgentEvent }
  | { type: 'IMPROVE_RESET' };

const idleStage = <T>(): StageState<T> => ({
  phase: 'idle',
  pass: 0,
  current: null,
  issues: [],
});

export const initialState: PageState = {
  spec: '',
  stages: {
    parse: idleStage<ParsedSpec>(),
    tests: idleStage<TestCase[]>(),
    rubric: idleStage<Rubric>(),
    run: idleStage<RunSnapshot>(),
    improve: { phase: 'idle' },
  },
  error: null,
};

function applyEvent<T>(stage: StageState<T>, event: RefinementEvent<T>): StageState<T> {
  switch (event.type) {
    case 'generated':
      return { ...stage, current: event.output, pass: 0 };
    case 'critiquing':
      return { ...stage, phase: 'critiquing', pass: event.pass };
    case 'critiqued': {
      const major = event.issues.filter((i) => i.severity === 'major');
      return {
        ...stage,
        issues: event.issues,
        phase: major.length === 0 ? 'done' : 'critiquing',
      };
    }
    case 'revising':
      return { ...stage, phase: 'revising', pass: event.pass };
    case 'revised':
      return { ...stage, phase: 'revising', current: event.output, pass: event.pass };
    case 'done':
      return { ...stage, phase: 'done', current: event.output };
    case 'error':
      return { ...stage, phase: 'error' };
  }
}

export function reducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case 'PIPELINE_START':
      return { ...initialState, spec: action.spec };
    case 'STAGE_START': {
      const reset = idleStage();
      return {
        ...state,
        stages: {
          ...state.stages,
          [action.stage]: { ...reset, phase: 'generating' },
        },
        error: null,
      };
    }
    case 'STAGE_EVENT': {
      const current = state.stages[action.stage];
      // Type narrowing: each stage holds a different T, but the reducer
      // treats output opaquely. Cast at the boundary.
      const updated = applyEvent(current as StageState<unknown>, action.event);
      const next: PageState = {
        ...state,
        stages: { ...state.stages, [action.stage]: updated },
      };
      if (action.event.type === 'error') {
        next.error = {
          stage: action.stage,
          message: action.event.message,
          recoverable: false,
        };
      }
      return next;
    }
    case 'STAGE_RUN_EVENT': {
      const cur = state.stages.run;
      let phase = cur.phase;
      let current = cur.current as RunSnapshot | null;
      let error = state.error;
      if (action.event.type === 'progress') {
        current = {
          kind: 'progress',
          completed: action.event.completed,
          total: action.event.total,
          partialResults: action.event.partialResults,
        };
      } else if (action.event.type === 'done') {
        phase = 'done';
        current = {
          kind: 'done',
          results: action.event.results,
          summary: action.event.summary,
        };
      } else if (action.event.type === 'error') {
        phase = 'error';
        error = { stage: 'run', message: action.event.message, recoverable: false };
      }
      return {
        ...state,
        stages: { ...state.stages, run: { ...cur, phase, current } },
        error,
      };
    }
    case 'STAGE_ERR': {
      const current = state.stages[action.stage];
      return {
        ...state,
        stages: {
          ...state.stages,
          [action.stage]: { ...current, phase: 'error' },
        },
        error: {
          stage: action.stage,
          message: action.message,
          recoverable: action.recoverable,
        },
      };
    }
    case 'RESET':
      return initialState;
    case 'IMPROVE_START': {
      return {
        ...state,
        stages: {
          ...state.stages,
          improve: { phase: 'running', events: [], snapshot: null },
        },
        error: null,
      };
    }
    case 'IMPROVE_EVENT': {
      const cur = state.stages.improve;
      const events = cur.phase === 'idle' ? [action.event] : [...(cur as { events?: AgentEvent[] }).events ?? [], action.event];
      const snapshot =
        action.event.type === 'started'
          ? action.event.snapshot
          : cur.phase === 'idle'
            ? null
            : (cur as { snapshot?: Snapshot | null }).snapshot ?? null;

      let next: ImproveStageState = { phase: 'running', events, snapshot };
      if (action.event.type === 'committed') {
        next = {
          phase: 'done-committed',
          events,
          snapshot: snapshot as Snapshot,
          finalState: action.event.finalState,
          diff: action.event.diff,
        };
      } else if (action.event.type === 'rolled-back') {
        next = {
          phase: 'done-rolled-back',
          events,
          snapshot: snapshot as Snapshot,
          restored: action.event.restored,
        };
      } else if (action.event.type === 'error') {
        next = {
          phase: 'error',
          events,
          snapshot,
          message: action.event.message,
        };
      }
      return { ...state, stages: { ...state.stages, improve: next } };
    }
    case 'IMPROVE_RESET': {
      return { ...state, stages: { ...state.stages, improve: { phase: 'idle' } } };
    }
    default:
      return state;
  }
}
