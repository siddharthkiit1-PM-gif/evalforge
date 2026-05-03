'use client';

import { Fragment, useMemo, useState } from 'react';
import type { EvalResult, Rubric } from '@/lib/types';
import { weightedOverall } from '@/lib/scoring';

const MAX_OUTPUT_LEN = 80;

function truncate(text: unknown, max = MAX_OUTPUT_LEN) {
  const s = typeof text === 'string' ? text : JSON.stringify(text) ?? '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export default function ResultsTable({
  results,
  rubric,
  threshold,
}: {
  results: EvalResult[];
  rubric: Rubric;
  threshold: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const passFlags = useMemo(
    () => results.map((r) => weightedOverall(r.scores, rubric) >= threshold),
    [results, rubric, threshold],
  );

  if (results.length === 0) {
    return <p className="font-body text-sm text-muted">No results yet.</p>;
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const dimById = new Map(rubric.dimensions.map((d) => [d.id, d]));

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-left">
        <thead className="bg-elevated">
          <tr className="font-mono text-xs uppercase tracking-wide text-muted">
            <th className="px-2 py-2 sm:px-4 w-16 sm:w-24">Test</th>
            <th className="px-2 py-2 sm:px-4">Output</th>
            <th className="px-2 py-2 sm:px-4 w-16 sm:w-24">Result</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const isOpen = expanded.has(r.testId);
            const passed = passFlags[i];
            return (
              <Fragment key={r.testId}>
                <tr
                  onClick={() => toggle(r.testId)}
                  className="cursor-pointer border-t border-border bg-surface align-top hover:bg-elevated"
                >
                  <td className="px-2 py-2 sm:px-4 font-mono text-xs text-muted">
                    {r.testId}
                  </td>
                  <td className="px-2 py-2 sm:px-4 font-body text-sm text-fg">
                    {truncate(r.output)}
                  </td>
                  <td className="px-2 py-2 sm:px-4">
                    <span
                      className={
                        'font-mono text-xs ' +
                        (passed ? 'text-success' : 'text-failure')
                      }
                    >
                      {passed ? 'pass' : 'fail'}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t border-border bg-surface">
                    <td colSpan={3} className="px-2 py-3 sm:px-4">
                      <ul className="flex flex-col gap-2">
                        {r.scores.map((s) => {
                          const dim = dimById.get(s.dimensionId);
                          return (
                            <li
                              key={s.dimensionId}
                              className="flex flex-col gap-1"
                            >
                              <span className="font-mono text-xs text-muted">
                                {(dim?.label ?? s.dimensionId) +
                                  ' · ' +
                                  s.score.toFixed(2)}
                              </span>
                              <span className="font-mono text-xs text-muted">
                                {s.reasoning}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
