'use client';

import type { AgentEvent, ToolName } from '@/lib/agent/types';

type Row = {
  iteration: number;
  name: ToolName;
  args: unknown;
  result: unknown | null;
};

function rowsFromEvents(events: AgentEvent[]): Row[] {
  const rows: Row[] = [];
  for (const e of events) {
    if (e.type === 'tool-call') {
      rows.push({ iteration: e.iteration, name: e.name, args: e.args, result: null });
    } else if (e.type === 'tool-result') {
      const last = rows[rows.length - 1];
      if (last && last.name === e.name && last.iteration === e.iteration && last.result === null) {
        last.result = e.result;
      }
    }
  }
  return rows;
}

function shortArgs(args: unknown): string {
  const j = JSON.stringify(args);
  if (j.length <= 60) return j;
  return j.slice(0, 57) + '…';
}

export default function AgentTranscript({ events }: { events: AgentEvent[] }) {
  const rows = rowsFromEvents(events);
  if (rows.length === 0) {
    return <p className="font-mono text-xs text-muted">Agent thinking…</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <li key={i} className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted">iter {r.iteration}</span>
            <span className="text-fg">{r.name}</span>
            <span className={r.result === null ? 'text-muted' : 'text-success'}>
              {r.result === null ? 'pending' : 'done'}
            </span>
          </div>
          <div className="mt-1 text-muted whitespace-pre-wrap break-all">{shortArgs(r.args)}</div>
        </li>
      ))}
    </ul>
  );
}
