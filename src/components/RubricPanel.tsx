import type { Rubric } from '@/lib/types';

export default function RubricPanel({ rubric }: { rubric: Rubric }) {
  if (rubric.dimensions.length === 0) {
    return <p className="font-body text-sm text-muted">No rubric dimensions.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {rubric.dimensions.map((d) => (
        <li
          key={d.id}
          className="flex items-start justify-between gap-4 rounded-md border border-border bg-surface px-4 py-3"
        >
          <div className="flex flex-col gap-1">
            <span className="font-display text-sm text-fg">{d.label}</span>
            <span className="font-body text-xs text-muted">{d.description}</span>
          </div>
          <span className="font-mono text-xs text-accent shrink-0">
            {Math.round(d.weight * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
