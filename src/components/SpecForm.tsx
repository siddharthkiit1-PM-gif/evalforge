'use client';

import { useState } from 'react';
import SpecInput from '@/components/SpecInput';
import { EXAMPLES } from '@/lib/examples';

type Props = {
  onSubmit: (spec: string) => void;
};

export default function SpecForm({ onSubmit }: Props) {
  const [spec, setSpec] = useState('');

  const trimmed = spec.trim();
  const canSubmit = trimmed.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(trimmed);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => setSpec(ex.spec)}
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted hover:border-border-hover hover:text-fg transition-colors"
          >
            {ex.label}
          </button>
        ))}
      </div>

      <SpecInput value={spec} onChange={setSpec} />

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-accent px-4 py-2 font-display text-sm text-bg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          Generate Eval Suite
        </button>
      </div>
    </form>
  );
}
