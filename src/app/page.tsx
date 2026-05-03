'use client';

import { useReducer } from 'react';
import SpecForm from '@/components/SpecForm';
import DomainBadge from '@/components/DomainBadge';
import TestSuiteTable from '@/components/TestSuiteTable';
import RubricPanel from '@/components/RubricPanel';
import { initialState, reducer } from '@/lib/pageReducer';
import type { StageKey, StageState } from '@/lib/pageReducer';
import type {
  ParsedSpec,
  RefinementEvent,
  Rubric,
  TestCase,
} from '@/lib/types';

const STAGE_LABEL: Record<StageKey, string> = {
  parse: 'parsed spec',
  tests: 'tests',
  rubric: 'rubric',
};

// Marker error class so the catch in `run()` can distinguish errors raised
// from SSE `error` frames (already recorded in state by the reducer with the
// correct `recoverable` flag) from network/parse errors that need a fresh
// STAGE_ERR dispatch.
class SSEEventError extends Error {
  readonly fromSSEEvent = true;
}

function statusText<T>(stage: StageKey, state: StageState<T>): string | null {
  if (state.phase === 'idle') return null;
  if (state.phase === 'done') return null;
  if (state.phase === 'error') return null;
  const label = STAGE_LABEL[stage];
  if (state.phase === 'generating') return `Generating ${label}…`;
  if (state.phase === 'critiquing')
    return `Critiquing ${label} (pass ${Math.max(state.pass, 1)}/2)…`;
  if (state.phase === 'revising')
    return `Revising ${label} (pass ${state.pass}/2)…`;
  return null;
}

// Parses an SSE response body and dispatches one event per `data:` frame.
// Resolves with the final `done` event's payload when the stream closes.
async function runStage<T>(
  url: string,
  body: unknown,
  stage: StageKey,
  dispatch: (action: {
    type: 'STAGE_EVENT';
    stage: StageKey;
    event: RefinementEvent<T>;
  }) => void,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (!res.body) throw new Error('Empty response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let final: T | null = null;
  let latest: T | null = null;
  let errored: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as RefinementEvent<T>;
      dispatch({ type: 'STAGE_EVENT', stage, event });
      if (event.type === 'generated' || event.type === 'revised') latest = event.output;
      if (event.type === 'done') final = event.output;
      if (event.type === 'error') errored = event.message;
    }
  }
  if (errored) throw new SSEEventError(errored);
  if (final !== null) return final;
  if (latest !== null) return latest;
  throw new Error('Stream closed without any output');
}

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);

  async function run(spec: string) {
    dispatch({ type: 'PIPELINE_START', spec });
    let currentStage: StageKey = 'parse';
    try {
      dispatch({ type: 'STAGE_START', stage: 'parse' });
      const parsed = await runStage<ParsedSpec>(
        '/api/parse-spec',
        { spec },
        'parse',
        dispatch,
      );
      currentStage = 'tests';
      dispatch({ type: 'STAGE_START', stage: 'tests' });
      await runStage<TestCase[]>(
        '/api/generate-tests',
        { parsed },
        'tests',
        dispatch,
      );
      currentStage = 'rubric';
      dispatch({ type: 'STAGE_START', stage: 'rubric' });
      await runStage<Rubric>(
        '/api/generate-rubric',
        { parsed },
        'rubric',
        dispatch,
      );
    } catch (err) {
      // SSE-event-originated errors are already recorded in state by the
      // reducer (with `recoverable: false`). Avoid clobbering that with a
      // STAGE_ERR dispatch that would downgrade them to recoverable.
      if (err instanceof SSEEventError) return;
      const message = err instanceof Error ? err.message : 'Unknown error.';
      dispatch({ type: 'STAGE_ERR', stage: currentStage, message, recoverable: true });
    }
  }

  const parsed = state.stages.parse.current;
  const tests = state.stages.tests.current;
  const rubric = state.stages.rubric.current;
  const ready =
    state.stages.parse.phase === 'done' &&
    state.stages.tests.phase === 'done' &&
    state.stages.rubric.phase === 'done';

  const parseStatus = statusText('parse', state.stages.parse);
  const testsStatus = statusText('tests', state.stages.tests);
  const rubricStatus = statusText('rubric', state.stages.rubric);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-4xl text-fg">EvalForge</h1>
        <p className="font-body text-base text-muted max-w-2xl">
          Paste an AI feature spec. Get a domain-aware eval suite that runs.
        </p>
      </header>

      <SpecForm onSubmit={run} />

      {parseStatus && (
        <p className="font-mono text-xs text-muted">{parseStatus}</p>
      )}

      {parsed && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl text-fg">Parsed spec</h2>
            <DomainBadge domain={parsed.domain} />
          </div>
          <div className="rounded-md border border-border bg-surface p-4 font-mono text-xs text-muted whitespace-pre-wrap">
            {JSON.stringify(parsed, null, 2)}
          </div>
        </section>
      )}

      {testsStatus && (
        <p className="font-mono text-xs text-muted">{testsStatus}</p>
      )}

      {tests && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-fg">
            Test suite ({tests.length})
          </h2>
          <TestSuiteTable tests={tests} />
        </section>
      )}

      {rubricStatus && (
        <p className="font-mono text-xs text-muted">{rubricStatus}</p>
      )}

      {rubric && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-fg">Rubric</h2>
          <RubricPanel rubric={rubric} />
        </section>
      )}

      {ready && (
        <p className="font-mono text-xs text-success">
          Ready. Plan C wires the runner.
        </p>
      )}

      {state.error && (
        <p
          className="font-mono text-xs text-failure"
          data-testid="pipeline-error"
          data-recoverable={state.error.recoverable ? 'true' : 'false'}
        >
          Error: {state.error.message}
        </p>
      )}
    </div>
  );
}
