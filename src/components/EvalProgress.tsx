type Props = { completed: number; total: number };
export default function EvalProgress({ completed, total }: Props) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between font-mono text-xs text-muted">
        <span>{completed} / {total}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-md bg-surface">
        <div className="h-full bg-fg transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
