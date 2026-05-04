'use client';

import type { SnapshotDiff } from '@/lib/agent/types';

function fmt(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(2)}`;
}

export default function AgentDiff({ diff }: { diff: SnapshotDiff }) {
  const overallClass = diff.overallDelta >= 0 ? 'text-success' : 'text-failure';
  const rubricIds = new Set(diff.rubricDimensionsChanged.map((r) => r.id));
  const filteredPerDim = diff.perDimensionDelta.filter((d) => !rubricIds.has(d.id));

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-base text-fg">Score change</h3>
        <span className={`font-mono text-sm ${overallClass}`}>{fmt(diff.overallDelta)} overall</span>
      </div>

      {filteredPerDim.length > 0 && (
        <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
          {filteredPerDim.map((d) => (
            <li key={d.id} className="flex items-baseline justify-between">
              <span className="text-muted">{d.id}</span>
              <span className={d.delta >= 0 ? 'text-success' : 'text-failure'}>{fmt(d.delta)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="font-mono text-xs text-muted">
        {diff.testsAdded.length} test{diff.testsAdded.length === 1 ? '' : 's'} added
        {diff.testsChanged.length > 0 && `, ${diff.testsChanged.length} rewritten`}
        {diff.testsRemoved.length > 0 && `, ${diff.testsRemoved.length} removed`}
      </div>

      {diff.rubricDimensionsChanged.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="font-mono text-xs text-muted">Rubric changes</h4>
          {diff.rubricDimensionsChanged.map((r) => (
            <div key={r.id} className="font-mono text-xs">
              <div className="text-fg">{r.id}</div>
              {r.beforeDescriptor !== r.afterDescriptor && (
                <>
                  <div className="text-muted line-through">{r.beforeDescriptor}</div>
                  <div className="text-fg">{r.afterDescriptor}</div>
                </>
              )}
              {Math.abs(r.weightDelta) > 1e-9 && (
                <div className="text-muted">weight {fmt(r.weightDelta)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
