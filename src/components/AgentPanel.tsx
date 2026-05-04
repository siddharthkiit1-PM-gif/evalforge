'use client';

import AgentTranscript from '@/components/AgentTranscript';
import AgentDiff from '@/components/AgentDiff';
import type { ImproveStageState } from '@/lib/pageReducer';

type Props = {
  state: ImproveStageState;
  triggerable: boolean;
  onImprove: () => void;
  onRestore: () => void;
};

export default function AgentPanel({ state, triggerable, onImprove, onRestore }: Props) {
  if (state.phase === 'idle' && !triggerable) return null;

  if (state.phase === 'idle') {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-fg">Below threshold</h2>
        <p className="font-body text-sm text-muted">
          The agent can try to lift the weakest dimensions automatically. It will run up to 5 improvement iterations and roll back if it makes things worse.
        </p>
        <button
          type="button"
          onClick={onImprove}
          className="self-start rounded-md border border-border bg-elevated px-3 py-2 font-mono text-xs text-fg hover:bg-surface"
        >
          Improve with agent
        </button>
      </section>
    );
  }

  if (state.phase === 'running') {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-fg">Agent is improving…</h2>
        <AgentTranscript events={state.events} />
      </section>
    );
  }

  if (state.phase === 'done-committed') {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl text-fg">Agent done</h2>
        <AgentDiff diff={state.diff} />
        <button
          type="button"
          onClick={onRestore}
          className="self-start rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-muted hover:bg-elevated"
        >
          Restore previous
        </button>
      </section>
    );
  }

  if (state.phase === 'done-rolled-back') {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-fg">Rolled back</h2>
        <p className="font-body text-sm text-muted">
          The improvement attempt regressed the overall score. Original tests and rubric were restored automatically.
        </p>
      </section>
    );
  }

  // error
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <h2 className="font-display text-xl text-failure">Agent error</h2>
      <p className="font-mono text-xs text-failure">{state.message}</p>
    </section>
  );
}
