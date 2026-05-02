import type { TestCase } from '@/lib/types';

const CATEGORY_LABEL: Record<TestCase['category'], string> = {
  happy_path: 'Happy path',
  edge_case: 'Edge case',
  adversarial: 'Adversarial',
};

export default function TestSuiteTable({ tests }: { tests: TestCase[] }) {
  if (tests.length === 0) {
    return (
      <p className="font-body text-sm text-muted">No tests generated.</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-left">
        <thead className="bg-elevated">
          <tr className="font-mono text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-2 w-24">ID</th>
            <th className="px-4 py-2 w-36">Category</th>
            <th className="px-4 py-2">Input</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => (
            <tr
              key={t.id}
              className="border-t border-border bg-surface align-top"
            >
              <td className="px-4 py-2 font-mono text-xs text-muted">{t.id}</td>
              <td className="px-4 py-2 font-body text-xs text-fg">
                {CATEGORY_LABEL[t.category]}
              </td>
              <td className="px-4 py-2 font-body text-sm text-fg">{t.input}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
