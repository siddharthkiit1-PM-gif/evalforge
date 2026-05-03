'use client';
type Props = { onRun: () => void; running: boolean };
export default function EvalRunButton({ onRun, running }: Props) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={running}
      className="self-start rounded-md border border-border bg-fg px-4 py-2 font-mono text-sm text-bg disabled:opacity-50"
    >
      {running ? 'Running…' : 'Run 20 evals'}
    </button>
  );
}
