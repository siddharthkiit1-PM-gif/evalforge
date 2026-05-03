'use client';

import { useMemo, useState } from 'react';
import type { EvalResult, ParsedSpec, Rubric, TestCase } from '@/lib/types';
import { summarize } from '@/lib/scoring';
import ResultsTable from '@/components/ResultsTable';
import ExportButtons from '@/components/ExportButtons';

type Props = {
  results: EvalResult[];
  rubric: Rubric;
  spec: string;
  parsed: ParsedSpec;
  tests: TestCase[];
};

export default function Scorecard({ results, rubric, spec, parsed, tests }: Props) {
  const [threshold, setThreshold] = useState<number>(0.7);

  const summary = useMemo(
    () => summarize(results, rubric, threshold),
    [results, rubric, threshold],
  );

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="font-display text-4xl text-fg">
          {summary.overall.toFixed(2)}
        </span>
        <span className="font-mono text-xs text-muted">
          {summary.passedCount} of {results.length} passed
        </span>
      </header>

      <label className="flex flex-col gap-2">
        <span className="font-mono text-xs text-muted">
          Pass threshold: {threshold.toFixed(2)}
        </span>
        <input
          type="range"
          min="0.5"
          max="1"
          step="0.05"
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full"
        />
      </label>

      <ul className="flex flex-col gap-2">
        {rubric.dimensions.map((dim) => {
          const value = summary.perDimension[dim.id] ?? 0;
          const pct = Math.round(value * 100);
          return (
            <li key={dim.id} className="flex flex-col gap-1">
              <div className="flex justify-between font-mono text-xs text-muted">
                <span>{dim.label}</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-md bg-surface">
                <div
                  className="h-full bg-fg"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <ResultsTable results={results} rubric={rubric} threshold={threshold} />

      <ExportButtons
        spec={spec}
        parsed={parsed}
        tests={tests}
        rubric={rubric}
        results={results}
        summary={summary}
      />
    </section>
  );
}
