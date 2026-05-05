'use client';

import { useState } from 'react';
import type { OrchestrateStageState } from '@/lib/pageReducer';
import type { OrchestratorEvent, OrchestratorState, OrchToolName } from '@/lib/agent/types';
import DomainBadge from '@/components/DomainBadge';
import TestSuiteTable from '@/components/TestSuiteTable';
import RubricPanel from '@/components/RubricPanel';
import Scorecard from '@/components/Scorecard';

type Row = {
  n: number;
  name: OrchToolName;
  args: unknown;
  publicResult: unknown | null;
};

function rowsFromEvents(events: OrchestratorEvent[]): Row[] {
  const rows: Row[] = [];
  for (const e of events) {
    if (e.type === 'orch-tool-call') {
      rows.push({ n: e.n, name: e.name, args: e.args, publicResult: null });
    } else if (e.type === 'orch-tool-result') {
      const last = rows[rows.length - 1];
      if (last && last.n === e.n && last.name === e.name && last.publicResult === null) {
        last.publicResult = e.public;
      }
    }
  }
  return rows;
}

function shortArgs(args: unknown): string {
  const j = JSON.stringify(args);
  if (!j || j === '{}') return '';
  if (j.length <= 60) return j;
  return j.slice(0, 57) + '…';
}

function latestBudget(events: OrchestratorEvent[]) {
  let spentTokens = 0;
  let iterations = 0;
  let cap: { capTokens: number; capIterations: number; capScoreThreshold: number } | null = null;
  for (const e of events) {
    if (e.type === 'orch-started') {
      cap = {
        capTokens: e.budget.capTokens,
        capIterations: e.budget.capIterations,
        capScoreThreshold: e.budget.capScoreThreshold,
      };
    } else if (e.type === 'orch-budget') {
      spentTokens = e.spentTokens;
      iterations = e.iterations;
    }
  }
  return { spentTokens, iterations, cap };
}

const REASON_LABEL: Record<string, string> = {
  'all-pass': 'All dimensions passing.',
  'iteration-cap': 'Stopped: iteration cap reached.',
  'budget-cap': 'Stopped: token budget exhausted.',
  'early-stop': 'Stopped early by the agent.',
};

export default function OrchestratorPanel({
  state,
  spec,
  onReset,
  onResume,
}: {
  state: OrchestrateStageState;
  spec: string;
  onReset: () => void;
  onResume: (id: string, answer: string) => void;
}) {
  if (state.phase === 'idle') return null;

  const events = state.events;
  const rows = rowsFromEvents(events);
  const { spentTokens, iterations, cap } = latestBudget(events);

  // Pull artifacts from finalState (when done) or latest (while streaming).
  const live: Partial<OrchestratorState> =
    state.phase === 'done'
      ? state.finalState
      : state.phase === 'running' || state.phase === 'awaiting-clarification'
        ? state.latest
        : {};
  const parsed = live.parsed;
  const tests = live.tests;
  const rubric = live.rubric;
  const summary = live.summary;
  const results = state.phase === 'done' ? state.finalState.results : undefined;
  const showScorecard = !!(results && rubric && parsed && tests);

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-bg p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-base text-fg">Orchestrator</h2>
        <span className="font-mono text-xs text-muted">
          iter {iterations}{cap ? ` / ${cap.capIterations}` : ''} · {spentTokens.toLocaleString()} tok
          {cap ? ` / ${cap.capTokens.toLocaleString()}` : ''}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="font-mono text-xs text-muted">Planning first move…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li
              key={i}
              className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">iter {r.n}</span>
                <span className="text-fg">{r.name}</span>
                <span className={r.publicResult === null ? 'text-muted' : 'text-success'}>
                  {r.publicResult === null ? 'pending' : 'done'}
                </span>
              </div>
              {shortArgs(r.args) && (
                <div className="mt-1 text-muted whitespace-pre-wrap break-all">{shortArgs(r.args)}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {state.phase === 'awaiting-clarification' && (
        <ClarificationForm
          question={state.question}
          onSubmit={(answer) => onResume(state.id, answer)}
        />
      )}

      {summary && !showScorecard && (
        <div className="rounded-md border border-border bg-surface p-3 font-mono text-xs">
          <div className="flex items-baseline justify-between">
            <span className="text-muted">overall</span>
            <span className="text-fg">{summary.overall.toFixed(2)}</span>
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-1">
            {Object.entries(summary.perDimension).map(([id, s]) => (
              <li key={id} className="flex items-baseline justify-between">
                <span className="text-muted">{id}</span>
                <span className={s >= 0.8 ? 'text-success' : s >= 0.6 ? 'text-fg' : 'text-failure'}>
                  {s.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {parsed && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm text-fg">Parsed spec</h3>
            <DomainBadge domain={parsed.domain} />
          </div>
          <div className="rounded-md border border-border bg-surface p-3 font-mono text-xs text-muted whitespace-pre-wrap">
            {JSON.stringify(parsed, null, 2)}
          </div>
        </section>
      )}

      {tests && tests.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-display text-sm text-fg">Test suite ({tests.length})</h3>
          <TestSuiteTable tests={tests} />
        </section>
      )}

      {rubric && (
        <section className="flex flex-col gap-2">
          <h3 className="font-display text-sm text-fg">Rubric</h3>
          <RubricPanel rubric={rubric} />
        </section>
      )}

      {showScorecard && parsed && tests && rubric && results && (
        <section className="flex flex-col gap-2">
          <h3 className="font-display text-sm text-fg">Results</h3>
          <Scorecard
            results={results}
            rubric={rubric}
            spec={spec}
            parsed={parsed}
            tests={tests}
          />
        </section>
      )}

      {state.phase === 'done' && (
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="text-muted">{REASON_LABEL[state.reason] ?? state.reason}</span>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-border px-3 py-1 text-fg hover:border-border-hover"
          >
            Run again
          </button>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="rounded-md border border-failure bg-surface p-3 font-mono text-xs text-failure">
          {state.message}
          <div className="mt-2">
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-border px-3 py-1 text-fg hover:border-border-hover"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ClarificationForm({
  question,
  onSubmit,
}: {
  question: string;
  onSubmit: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const trimmed = answer.trim();
  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || submitted) return;
    setSubmitted(true);
    onSubmit(trimmed);
  };
  return (
    <form
      onSubmit={handle}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
    >
      <p className="font-mono text-xs text-muted">Agent is asking</p>
      <p className="font-body text-sm text-fg">{question}</p>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        disabled={submitted}
        className="rounded-md border border-border bg-bg p-2 font-mono text-xs text-fg disabled:opacity-50"
        placeholder="Your answer…"
        autoFocus
      />
      <button
        type="submit"
        disabled={!trimmed || submitted}
        className="self-start rounded-md border border-border px-3 py-1 font-mono text-xs text-fg hover:border-border-hover disabled:opacity-50"
      >
        {submitted ? 'Resuming…' : 'Send'}
      </button>
    </form>
  );
}
