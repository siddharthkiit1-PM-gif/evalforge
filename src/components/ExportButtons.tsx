'use client';

import type { Bundle } from '@/lib/export';
import { toBundleJSON, toResultsJSON, toCSV } from '@/lib/export';

type Props = Bundle;

function download(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportButtons(props: Props) {
  const { spec, parsed, tests, rubric, results, summary } = props;

  function onBundle() {
    download(
      'evalforge-bundle.json',
      toBundleJSON({ spec, parsed, tests, rubric, results, summary }),
      'application/json',
    );
  }

  function onResults() {
    download('evalforge-results.json', toResultsJSON(results), 'application/json');
  }

  function onCSV() {
    download('evalforge-results.csv', toCSV(results, rubric), 'text/csv');
  }

  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
      <button
        type="button"
        onClick={onBundle}
        className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-fg hover:bg-elevated"
      >
        Download bundle
      </button>
      <button
        type="button"
        onClick={onResults}
        className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-fg hover:bg-elevated"
      >
        Download results JSON
      </button>
      <button
        type="button"
        onClick={onCSV}
        className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-fg hover:bg-elevated"
      >
        Download CSV
      </button>
    </div>
  );
}
