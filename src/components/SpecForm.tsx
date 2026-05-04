'use client';

import { useEffect, useRef, useState } from 'react';
import { EXAMPLES } from '@/lib/examples';

const MAX_LEN = 5000;

type Props = {
  onSubmit: (spec: string, agentMode: boolean) => void;
};

export default function SpecForm({ onSubmit }: Props) {
  const [spec, setSpec] = useState('');
  const [agentMode, setAgentMode] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [spec]);

  const trimmed = spec.trim();
  const canSubmit = trimmed.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(trimmed, agentMode);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => setSpec(ex.spec.slice(0, MAX_LEN))}
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted hover:border-border-hover hover:text-fg transition-colors"
          >
            {ex.label}
          </button>
        ))}
      </div>

      <textarea
        ref={ref}
        value={spec}
        onChange={(e) => setSpec(e.target.value)}
        placeholder="Paste an AI feature spec…"
        rows={6}
        maxLength={MAX_LEN}
        className="w-full resize-none rounded-md border border-border bg-surface px-4 py-3 font-mono text-sm text-fg placeholder:text-dim focus:border-border-hover focus:outline-none disabled:opacity-50"
      />

      <p className="font-mono text-xs text-muted self-end">
        {spec.length} / {MAX_LEN}
      </p>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 font-mono text-xs text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agentMode}
            onChange={(e) => setAgentMode(e.target.checked)}
            className="h-3 w-3 accent-accent"
          />
          Run as agent (experimental)
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-accent px-4 py-2 font-display text-sm text-bg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {agentMode ? 'Run Agent' : 'Generate Eval Suite'}
        </button>
      </div>
    </form>
  );
}
