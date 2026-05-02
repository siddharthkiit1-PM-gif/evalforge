'use client';

import { useReducer } from 'react';
import SpecForm from '@/components/SpecForm';
import DomainBadge from '@/components/DomainBadge';
import TestSuiteTable from '@/components/TestSuiteTable';
import RubricPanel from '@/components/RubricPanel';
import { initialState, reducer } from '@/lib/pageReducer';
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return (await res.json()) as T;
}

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);

  async function run(spec: string) {
    dispatch({ type: 'PARSE_STARTED', spec });
    try {
      const parsed = await postJSON<ParsedSpec>('/api/parse-spec', { spec });
      dispatch({ type: 'PARSE_SUCCEEDED', parsed });

      const testsResp = await postJSON<{ tests: TestCase[] }>(
        '/api/generate-tests',
        { parsed },
      );
      dispatch({ type: 'TESTS_SUCCEEDED', tests: testsResp.tests });

      const rubric = await postJSON<Rubric>('/api/generate-rubric', { parsed });
      dispatch({ type: 'RUBRIC_SUCCEEDED', rubric });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      dispatch({ type: 'FAILED', error: message });
    }
  }

  const busy =
    state.status === 'parsing' ||
    state.status === 'tests_generating' ||
    state.status === 'rubric_generating';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-4xl text-fg">EvalForge</h1>
        <p className="font-body text-base text-muted max-w-2xl">
          Paste an AI feature spec. Get a domain-aware eval suite that runs.
        </p>
      </header>

      <SpecForm onSubmit={run} />

      {state.status === 'parsing' && (
        <p className="font-mono text-xs text-muted">Parsing spec…</p>
      )}

      {state.parsed && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl text-fg">Parsed spec</h2>
            <DomainBadge domain={state.parsed.domain} />
          </div>
          <div className="rounded-md border border-border bg-surface p-4 font-mono text-xs text-muted whitespace-pre-wrap">
            {JSON.stringify(state.parsed, null, 2)}
          </div>
        </section>
      )}

      {state.status === 'tests_generating' && (
        <p className="font-mono text-xs text-muted">Generating tests…</p>
      )}

      {state.tests && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-fg">
            Test suite ({state.tests.length})
          </h2>
          <TestSuiteTable tests={state.tests} />
        </section>
      )}

      {state.status === 'rubric_generating' && (
        <p className="font-mono text-xs text-muted">Generating rubric…</p>
      )}

      {state.rubric && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-fg">Rubric</h2>
          <RubricPanel rubric={state.rubric} />
        </section>
      )}

      {state.status === 'ready' && (
        <p className="font-mono text-xs text-success">Ready. Plan C wires the runner.</p>
      )}

      {state.status === 'error' && state.error && (
        <p className="font-mono text-xs text-failure">Error: {state.error}</p>
      )}

      {busy && (
        <p className="sr-only" role="status">Working…</p>
      )}
    </div>
  );
}
