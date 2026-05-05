'use client';

import { useReducer } from 'react';
import SpecForm from '@/components/SpecForm';
import DomainBadge from '@/components/DomainBadge';
import TestSuiteTable from '@/components/TestSuiteTable';
import RubricPanel from '@/components/RubricPanel';
import EvalRunButton from '@/components/EvalRunButton';
import EvalProgress from '@/components/EvalProgress';
import Scorecard from '@/components/Scorecard';
import AgentPanel from '@/components/AgentPanel';
import OrchestratorPanel from '@/components/OrchestratorPanel';
import { initialState, reducer } from '@/lib/pageReducer';
import type { StageKey, StageState } from '@/lib/pageReducer';
import type {
  ParsedSpec,
  RefinementEvent,
  Rubric,
  RunEvent,
  TestCase,
} from '@/lib/types';
import type { AgentEvent, OrchestratorEvent } from '@/lib/agent/types';

const STAGE_LABEL: Record<StageKey, string> = {
  parse: 'parsed spec',
  tests: 'tests',
  rubric: 'rubric',
  run: 'run',
  improve: 'improvement',
  orchestrate: 'orchestration',
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

// SSE consumer for the run stage. Parses each frame as a `RunEvent` and
// dispatches `STAGE_RUN_EVENT`. Resolves when the stream closes; rejects on
// transport errors or `error` frames (wrapped in SSEEventError so the catch
// site can preserve the reducer-recorded `recoverable: false`).
async function runRunStage(
  url: string,
  body: unknown,
  dispatch: (action: { type: 'STAGE_RUN_EVENT'; event: RunEvent }) => void,
): Promise<void> {
  console.log('[run-eval] POST', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log('[run-eval] status', res.status);
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
  let errored: string | null = null;
  let sawDone = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      console.log('[run-eval] stream closed; sawDone=', sawDone, 'errored=', errored);
      break;
    }
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as RunEvent;
      console.log('[run-eval] event', event.type, event.type === 'progress' ? `${event.completed}/${event.total}` : '');
      dispatch({ type: 'STAGE_RUN_EVENT', event });
      if (event.type === 'error') errored = event.message;
      if (event.type === 'done') sawDone = true;
    }
  }
  if (errored) throw new SSEEventError(errored);
}

async function runOrchestrateStage(
  url: string,
  body: unknown,
  dispatch: (action: { type: 'ORCHESTRATE_EVENT'; event: OrchestratorEvent }) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (!res.body) throw new Error('Empty response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
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
      const event = JSON.parse(line.slice(6)) as OrchestratorEvent;
      dispatch({ type: 'ORCHESTRATE_EVENT', event });
      if (event.type === 'orch-error') errored = event.message;
    }
  }
  if (errored) throw new SSEEventError(errored);
}

async function runImproveStage(
  url: string,
  body: unknown,
  dispatch: (action: { type: 'IMPROVE_EVENT'; event: AgentEvent }) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (!res.body) throw new Error('Empty response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
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
      const event = JSON.parse(line.slice(6)) as AgentEvent;
      dispatch({ type: 'IMPROVE_EVENT', event });
      if (event.type === 'error') errored = event.message;
    }
  }
  if (errored) throw new SSEEventError(errored);
}

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);

  async function runOrchestrate(spec: string) {
    dispatch({ type: 'ORCHESTRATE_START', spec });
    try {
      await runOrchestrateStage('/api/orchestrate', { spec }, dispatch);
    } catch (err) {
      if (err instanceof SSEEventError) return;
      const message = err instanceof Error ? err.message : 'Unknown error.';
      dispatch({ type: 'ORCHESTRATE_EVENT', event: { type: 'orch-error', message } });
    }
  }

  async function resumeOrchestrate(id: string, answer: string) {
    try {
      await runOrchestrateStage('/api/orchestrate/resume', { id, answer }, dispatch);
    } catch (err) {
      if (err instanceof SSEEventError) return;
      const message = err instanceof Error ? err.message : 'Unknown error.';
      dispatch({ type: 'ORCHESTRATE_EVENT', event: { type: 'orch-error', message } });
    }
  }

  function onSpecSubmit(spec: string, agentMode: boolean) {
    if (agentMode) {
      void runOrchestrate(spec);
    } else {
      void run(spec);
    }
  }

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
  const runState = state.stages.run;
  const ready =
    state.stages.parse.phase === 'done' &&
    state.stages.tests.phase === 'done' &&
    state.stages.rubric.phase === 'done';

  async function runEval() {
    if (!parsed || !tests || !rubric) return;
    dispatch({ type: 'STAGE_START', stage: 'run' });
    try {
      await runRunStage(
        '/api/run-eval',
        { parsed, rubric, tests },
        dispatch,
      );
    } catch (err) {
      if (err instanceof SSEEventError) return;
      const message = err instanceof Error ? err.message : 'Unknown error.';
      dispatch({ type: 'STAGE_ERR', stage: 'run', message, recoverable: true });
    }
  }

  async function runImprove() {
    if (!parsed || !tests || !rubric) return;
    if (runState.phase !== 'done' || runState.current?.kind !== 'done') return;
    const summary = runState.current.summary;
    const results = runState.current.results;
    dispatch({ type: 'IMPROVE_START' });
    try {
      await runImproveStage(
        '/api/improve',
        { parsed, tests, rubric, results, summary },
        dispatch,
      );
    } catch (err) {
      if (err instanceof SSEEventError) return;
      const message = err instanceof Error ? err.message : 'Unknown error.';
      dispatch({ type: 'IMPROVE_EVENT', event: { type: 'error', message } });
    }
  }

  function restorePrevious() {
    dispatch({ type: 'IMPROVE_RESET' });
  }

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

      <SpecForm onSubmit={onSpecSubmit} />

      {state.stages.orchestrate.phase !== 'idle' && (
        <OrchestratorPanel
          state={state.stages.orchestrate}
          spec={state.spec}
          onReset={() => dispatch({ type: 'ORCHESTRATE_RESET' })}
          onResume={(id, answer) => void resumeOrchestrate(id, answer)}
        />
      )}

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

      {ready && parsed && tests && rubric && runState.phase === 'idle' && (
        <EvalRunButton onRun={runEval} running={false} />
      )}

      {ready && parsed && tests && rubric && runState.phase === 'generating' && (
        <div className="flex flex-col gap-4">
          <EvalRunButton onRun={runEval} running={true} />
          <EvalProgress
            completed={runState.current?.kind === 'progress' ? runState.current.completed : 0}
            total={runState.current?.kind === 'progress' ? runState.current.total : tests.length}
          />
        </div>
      )}

      {ready &&
        parsed &&
        tests &&
        rubric &&
        runState.phase === 'done' &&
        runState.current?.kind === 'done' && (
          <>
            <Scorecard
              results={runState.current.results}
              rubric={rubric}
              spec={state.spec}
              parsed={parsed}
              tests={tests}
            />
            <AgentPanel
              state={state.stages.improve}
              triggerable={(() => {
                const s = runState.current.summary;
                return (
                  s.overall < 0.75 ||
                  Object.values(s.perDimension).some((v) => v < 0.6)
                );
              })()}
              onImprove={runImprove}
              onRestore={restorePrevious}
            />
          </>
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
