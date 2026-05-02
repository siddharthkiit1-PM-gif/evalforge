'use client';

import { useEffect, useRef } from 'react';

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

export default function SpecInput({ value, onChange, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="Paste an AI feature spec…"
      rows={6}
      className="w-full resize-none rounded-md border border-border bg-surface px-4 py-3 font-mono text-sm text-fg placeholder:text-dim focus:border-border-hover focus:outline-none disabled:opacity-50"
    />
  );
}
