import type { AgentState, Snapshot, SnapshotDiff } from '@/lib/agent/types';

// Deep-clone the state into an immutable snapshot.
export function takeSnapshot(state: AgentState): Snapshot {
  return structuredClone({
    tests: state.tests,
    rubric: state.rubric,
    results: state.results,
    summary: state.summary,
  });
}

// Return a fresh clone of a snapshot. Used when restoring after rollback.
export function restoreSnapshot(snap: Snapshot): {
  tests: Snapshot['tests'];
  rubric: Snapshot['rubric'];
  results: Snapshot['results'];
  summary: Snapshot['summary'];
} {
  return structuredClone(snap);
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const beforeIds = new Set(before.tests.map((t) => t.id));
  const afterIds = new Set(after.tests.map((t) => t.id));

  const testsAdded = after.tests.filter((t) => !beforeIds.has(t.id));
  const testsRemoved = before.tests.filter((t) => !afterIds.has(t.id));

  const beforeById = new Map(before.tests.map((t) => [t.id, t]));
  const testsChanged: { before: typeof before.tests[number]; after: typeof after.tests[number] }[] = [];
  for (const a of after.tests) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      testsChanged.push({ before: b, after: a });
    }
  }

  const beforeDimById = new Map(before.rubric.dimensions.map((d) => [d.id, d]));
  const rubricDimensionsChanged: SnapshotDiff['rubricDimensionsChanged'] = [];
  for (const a of after.rubric.dimensions) {
    const b = beforeDimById.get(a.id);
    if (!b) continue;
    const descriptorChanged = a.description !== b.description;
    const weightDelta = a.weight - b.weight;
    if (descriptorChanged || Math.abs(weightDelta) > 1e-9) {
      rubricDimensionsChanged.push({
        id: a.id,
        beforeDescriptor: b.description,
        afterDescriptor: a.description,
        weightDelta,
      });
    }
  }

  const overallDelta = after.summary.overall - before.summary.overall;
  const perDimensionDelta = Object.keys(after.summary.perDimension).map((id) => ({
    id,
    delta: (after.summary.perDimension[id] ?? 0) - (before.summary.perDimension[id] ?? 0),
  }));

  return { testsAdded, testsRemoved, testsChanged, rubricDimensionsChanged, overallDelta, perDimensionDelta };
}
