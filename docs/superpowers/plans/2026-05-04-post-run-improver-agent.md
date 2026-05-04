# Post-Run Improver Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an autonomous post-run improver agent that loops up to 5 iterations to lift weak eval scores using a 7-tool toolbelt, with snapshot + auto-rollback safety.

**Architecture:** New `src/lib/agent/` module with pure types/snapshot/triggers/loop, an AI-SDK-powered planner using AI Gateway (Pro for planner, Flash-Lite for tool sub-LLMs), 7 tools each in its own file, and a thin SSE route at `/api/improve`. Existing `/api/run-eval/route.ts` gets one mechanical refactor: extract eval execution into `src/lib/runEval.ts` so the route and the agent's `rerun_eval` tool share it. UI adds an `AgentPanel` below the existing `Scorecard`.

**Tech Stack:** Next.js 16.2.4 (App Router), React 19, TypeScript, Vercel AI SDK v6 (`ai` package), Vercel AI Gateway, Zod, Vitest, Tailwind v4. Existing `@google/genai` `generateJSON` stays for non-planner LLM calls.

**Spec:** `docs/superpowers/specs/2026-05-04-post-run-improver-agent-design.md`

---

## File map

**New files:**
- `src/lib/agent/types.ts` — `AgentEvent`, `AgentState`, `AgentIteration`, `Snapshot`, `SnapshotDiff`, `StopReason`, `ToolName`, `StateUpdate`
- `src/lib/agent/snapshot.ts` — `takeSnapshot`, `restoreSnapshot`, `diffSnapshots`
- `src/lib/agent/triggers.ts` — `shouldTrigger`, `shouldStop`, `weakestDimension`
- `src/lib/agent/planner.ts` — `buildPlannerPrompt`, `callPlanner`
- `src/lib/agent/tools/index.ts` — `TOOLS` registry
- `src/lib/agent/tools/diagnose.ts`
- `src/lib/agent/tools/addTests.ts`
- `src/lib/agent/tools/addAdversarial.ts`
- `src/lib/agent/tools/reviseRubric.ts`
- `src/lib/agent/tools/tightenDescriptors.ts`
- `src/lib/agent/tools/rewriteTest.ts`
- `src/lib/agent/tools/rerunEval.ts`
- `src/lib/agent/loop.ts` — `runAgentLoop`
- `src/lib/runEval.ts` — extracted from `/api/run-eval/route.ts`
- `src/app/api/improve/route.ts`
- `src/components/AgentPanel.tsx`
- `src/components/AgentTranscript.tsx`
- `src/components/AgentDiff.tsx`
- Test files mirror source paths under `src/lib/agent/__tests__/` and `src/components/__tests__/`

**Modified files:**
- `src/app/api/run-eval/route.ts` — call extracted `runEval` helper
- `src/lib/pageReducer.ts` — add `improve` stage + `ImproveStageState` + actions
- `src/lib/types.ts` — re-export `AgentEvent` for UI imports
- `src/app/page.tsx` — render `AgentPanel` below `Scorecard`, wire `improve` SSE consumer
- `package.json` — add `ai` and `zod` dependencies

---

## Task 0: Install dependencies and verify baseline

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify clean baseline**

Run: `cd /Users/siddharthagrawal/evalforge && git status && pnpm test:run 2>&1 | tail -5`

Expected: clean working tree on `dev`. All existing tests pass.

- [ ] **Step 2: Install AI SDK and Zod**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm add ai zod`

Expected: `package.json` and lockfile updated. No peer-dep warnings that fail the install.

- [ ] **Step 3: Add AI Gateway env var to .env.local (manual, document only)**

The agent's planner needs `AI_GATEWAY_API_KEY`. Add to `.env.local` (do NOT commit):

```
AI_GATEWAY_API_KEY=<get from vercel dashboard>
```

If the env var is missing the route will return a 500 with a clear error message at request time (handled in Task 11).

- [ ] **Step 4: Verify install + tests still green**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run 2>&1 | tail -5`

Expected: same test count as before, all pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add ai-sdk and zod for post-run improver agent"
```

---

## Task 1: Add agent types

**Files:**
- Create: `src/lib/agent/types.ts`
- Test: `src/lib/agent/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/__tests__/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type {
  AgentEvent,
  AgentState,
  Snapshot,
  SnapshotDiff,
  AgentIteration,
  StopReason,
  ToolName,
  StateUpdate,
} from '@/lib/agent/types';

describe('agent types', () => {
  it('AgentEvent discriminated union compiles for all variants', () => {
    const events: AgentEvent[] = [
      { type: 'started', snapshot: {} as Snapshot, threshold: 0.7, maxIterations: 5 },
      { type: 'iteration-start', iteration: 1 },
      { type: 'planner-thinking', iteration: 1 },
      { type: 'tool-call', iteration: 1, name: 'diagnose_failures', args: {} },
      { type: 'tool-result', iteration: 1, name: 'diagnose_failures', result: {} },
      { type: 'iteration-end', iteration: 1 },
      { type: 'loop-end', reason: 'all-pass', finalSummary: { overall: 0.9, passedCount: 18, perDimension: {} } },
      { type: 'committed', finalState: {} as AgentState, diff: {} as SnapshotDiff },
      { type: 'rolled-back', reason: 'overall-regressed', restored: {} as Snapshot },
      { type: 'aborted' },
      { type: 'error', message: 'boom' },
    ];
    expect(events).toHaveLength(11);
  });

  it('StopReason union compiles for the three reasons', () => {
    const reasons: StopReason[] = ['all-pass', 'iteration-cap', 'no-improvement'];
    expect(reasons).toHaveLength(3);
  });

  it('ToolName union covers the seven tools', () => {
    const tools: ToolName[] = [
      'diagnose_failures',
      'add_tests',
      'add_adversarial_tests',
      'revise_rubric',
      'tighten_rubric_descriptors',
      'rewrite_test',
      'rerun_eval',
    ];
    expect(tools).toHaveLength(7);
  });

  it('StateUpdate is a partial of AgentState', () => {
    const u: StateUpdate = { tests: [] };
    expect(u).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/agent/__tests__/types.test.ts`

Expected: FAIL — `Cannot find module '@/lib/agent/types'`.

- [ ] **Step 3: Create the types module**

Create `src/lib/agent/types.ts`:

```ts
import type { ParsedSpec, Rubric, TestCase, EvalResult } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

// Working state the agent loop carries between iterations.
export type AgentState = {
  parsed: ParsedSpec;
  tests: TestCase[];
  rubric: Rubric;
  results: EvalResult[];
  summary: Summary;
};

// Partial state returned by tool handlers; the loop merges this into AgentState.
export type StateUpdate = Partial<AgentState>;

// Snapshot taken at loop start for rollback.
export type Snapshot = {
  tests: TestCase[];
  rubric: Rubric;
  results: EvalResult[];
  summary: Summary;
};

// Diff between snapshot at loop start and final agent state.
export type SnapshotDiff = {
  testsAdded: TestCase[];
  testsRemoved: TestCase[];
  testsChanged: { before: TestCase; after: TestCase }[];
  rubricDimensionsChanged: {
    id: string;
    beforeDescriptor: string;
    afterDescriptor: string;
    weightDelta: number;
  }[];
  overallDelta: number;
  perDimensionDelta: { id: string; delta: number }[];
};

export type ToolName =
  | 'diagnose_failures'
  | 'add_tests'
  | 'add_adversarial_tests'
  | 'revise_rubric'
  | 'tighten_rubric_descriptors'
  | 'rewrite_test'
  | 'rerun_eval';

export type StopReason = 'all-pass' | 'iteration-cap' | 'no-improvement';

// One pass through the loop after a tool executes.
export type AgentIteration = {
  iteration: number;
  toolName: ToolName;
  args: unknown;
  result: unknown;
  summaryAfter: Summary;
  // The change in the weakest-dimension score since the previous iteration.
  // 0 for iteration 1 (no prior to compare).
  weakestDeltaSinceLast: number;
};

// SSE event payloads streamed by /api/improve.
export type AgentEvent =
  | { type: 'started'; snapshot: Snapshot; threshold: number; maxIterations: number }
  | { type: 'iteration-start'; iteration: number }
  | { type: 'planner-thinking'; iteration: number }
  | { type: 'tool-call'; iteration: number; name: ToolName; args: unknown }
  | { type: 'tool-result'; iteration: number; name: ToolName; result: unknown }
  | { type: 'iteration-end'; iteration: number }
  | { type: 'loop-end'; reason: StopReason; finalSummary: Summary }
  | { type: 'committed'; finalState: AgentState; diff: SnapshotDiff }
  | { type: 'rolled-back'; reason: 'overall-regressed'; restored: Snapshot }
  | { type: 'aborted' }
  | { type: 'error'; message: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/agent/__tests__/types.test.ts`

Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/types.ts src/lib/agent/__tests__/types.test.ts
git commit -m "feat(agent): add core types for post-run improver agent"
```

---

## Task 2: Snapshot module

**Files:**
- Create: `src/lib/agent/snapshot.ts`
- Test: `src/lib/agent/__tests__/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/__tests__/snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { takeSnapshot, restoreSnapshot, diffSnapshots } from '@/lib/agent/snapshot';
import type { AgentState, Snapshot } from '@/lib/agent/types';

const baseState = (): AgentState => ({
  parsed: { feature: 'f', inputs: ['i'], outputs: ['o'], constraints: [], domain: 'legal' },
  tests: [
    { id: 'test-01', category: 'happy_path', input: 'a' },
    { id: 'test-02', category: 'edge_case', input: 'b' },
  ],
  rubric: {
    dimensions: [
      { id: 'd1', label: 'D1', description: 'orig', weight: 0.6 },
      { id: 'd2', label: 'D2', description: 'orig', weight: 0.4 },
    ],
  },
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: { d1: 0.4, d2: 0.7 } },
});

describe('takeSnapshot', () => {
  it('deep-clones state — mutating original does not affect snapshot', () => {
    const s = baseState();
    const snap = takeSnapshot(s);
    s.tests.push({ id: 'test-03', category: 'happy_path', input: 'c' });
    s.rubric.dimensions[0].description = 'changed';
    expect(snap.tests).toHaveLength(2);
    expect(snap.rubric.dimensions[0].description).toBe('orig');
  });
});

describe('restoreSnapshot', () => {
  it('returns a fresh clone — mutating return does not affect snapshot', () => {
    const snap: Snapshot = takeSnapshot(baseState());
    const restored = restoreSnapshot(snap);
    restored.tests.push({ id: 'test-99', category: 'happy_path', input: 'x' });
    expect(snap.tests).toHaveLength(2);
  });
});

describe('diffSnapshots', () => {
  it('detects added tests', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.tests.push({ id: 'test-03', category: 'adversarial', input: 'new' });
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.testsAdded).toHaveLength(1);
    expect(diff.testsAdded[0].id).toBe('test-03');
    expect(diff.testsChanged).toHaveLength(0);
  });

  it('detects changed tests by id', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.tests[0] = { id: 'test-01', category: 'happy_path', input: 'rewritten' };
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.testsChanged).toHaveLength(1);
    expect(diff.testsChanged[0].after.input).toBe('rewritten');
    expect(diff.testsAdded).toHaveLength(0);
  });

  it('detects rubric descriptor changes and weight deltas', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.rubric.dimensions[0].description = 'tighter wording';
    afterState.rubric.dimensions[0].weight = 0.7;
    afterState.rubric.dimensions[1].weight = 0.3;
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.rubricDimensionsChanged).toHaveLength(2);
    const d1 = diff.rubricDimensionsChanged.find((r) => r.id === 'd1')!;
    expect(d1.beforeDescriptor).toBe('orig');
    expect(d1.afterDescriptor).toBe('tighter wording');
    expect(d1.weightDelta).toBeCloseTo(0.1, 5);
  });

  it('computes overall and per-dimension score deltas', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.summary = { overall: 0.75, passedCount: 14, perDimension: { d1: 0.8, d2: 0.7 } };
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.overallDelta).toBeCloseTo(0.25, 5);
    const d1 = diff.perDimensionDelta.find((p) => p.id === 'd1')!;
    expect(d1.delta).toBeCloseTo(0.4, 5);
  });

  it('handles tests removed from after', () => {
    const before = takeSnapshot(baseState());
    const afterState = baseState();
    afterState.tests = afterState.tests.filter((t) => t.id !== 'test-02');
    const after = takeSnapshot(afterState);
    const diff = diffSnapshots(before, after);
    expect(diff.testsRemoved).toHaveLength(1);
    expect(diff.testsRemoved[0].id).toBe('test-02');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/agent/__tests__/snapshot.test.ts`

Expected: FAIL — `Cannot find module '@/lib/agent/snapshot'`.

- [ ] **Step 3: Implement the snapshot module**

Create `src/lib/agent/snapshot.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/agent/__tests__/snapshot.test.ts`

Expected: PASS, 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/snapshot.ts src/lib/agent/__tests__/snapshot.test.ts
git commit -m "feat(agent): add snapshot/restore/diff for rollback safety"
```

---

## Task 3: Triggers module

**Files:**
- Create: `src/lib/agent/triggers.ts`
- Test: `src/lib/agent/__tests__/triggers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/__tests__/triggers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldTrigger, shouldStop, weakestDimension } from '@/lib/agent/triggers';
import type { AgentIteration } from '@/lib/agent/types';
import type { Summary } from '@/lib/scoring';

const sum = (overall: number, perDimension: Record<string, number>): Summary => ({
  overall,
  passedCount: 0,
  perDimension,
});

const iter = (
  iteration: number,
  weakestDeltaSinceLast: number,
  summary: Summary,
): AgentIteration => ({
  iteration,
  toolName: 'rerun_eval',
  args: {},
  result: {},
  summaryAfter: summary,
  weakestDeltaSinceLast,
});

describe('shouldTrigger', () => {
  it('returns true when overall is below threshold', () => {
    expect(shouldTrigger(sum(0.5, { d1: 0.9, d2: 0.9 }), 0.7)).toBe(true);
  });
  it('returns true when any dimension is below threshold', () => {
    expect(shouldTrigger(sum(0.85, { d1: 0.6, d2: 0.95 }), 0.7)).toBe(true);
  });
  it('returns false when overall and all dimensions are at or above threshold', () => {
    expect(shouldTrigger(sum(0.8, { d1: 0.7, d2: 0.9 }), 0.7)).toBe(false);
  });
});

describe('weakestDimension', () => {
  it('returns the dimension with the lowest score', () => {
    expect(weakestDimension(sum(0.6, { a: 0.4, b: 0.7, c: 0.5 }))).toBe('a');
  });
  it('returns null for empty perDimension', () => {
    expect(weakestDimension(sum(0, {}))).toBeNull();
  });
});

describe('shouldStop', () => {
  it('returns "all-pass" when overall and every dimension >= threshold', () => {
    const history = [iter(1, 0, sum(0.85, { d1: 0.8, d2: 0.9 }))];
    expect(shouldStop(history, 0.7)).toBe('all-pass');
  });
  it('returns "iteration-cap" at 5 iterations', () => {
    const history = [
      iter(1, 0.1, sum(0.5, { d1: 0.4 })),
      iter(2, 0.1, sum(0.55, { d1: 0.45 })),
      iter(3, 0.1, sum(0.6, { d1: 0.5 })),
      iter(4, 0.1, sum(0.65, { d1: 0.55 })),
      iter(5, 0.1, sum(0.68, { d1: 0.58 })),
    ];
    expect(shouldStop(history, 0.7)).toBe('iteration-cap');
  });
  it('returns "no-improvement" when last 2 deltas are below 0.05', () => {
    const history = [
      iter(1, 0.0, sum(0.5, { d1: 0.4 })),
      iter(2, 0.06, sum(0.55, { d1: 0.46 })),
      iter(3, 0.02, sum(0.56, { d1: 0.48 })),
      iter(4, 0.01, sum(0.57, { d1: 0.49 })),
    ];
    expect(shouldStop(history, 0.7)).toBe('no-improvement');
  });
  it('returns null when only one iteration exists (cannot evaluate no-improvement)', () => {
    const history = [iter(1, 0, sum(0.6, { d1: 0.5 }))];
    expect(shouldStop(history, 0.7)).toBeNull();
  });
  it('returns null when most recent delta is large', () => {
    const history = [
      iter(1, 0.0, sum(0.5, { d1: 0.4 })),
      iter(2, 0.01, sum(0.51, { d1: 0.41 })),
      iter(3, 0.2, sum(0.6, { d1: 0.6 })),
    ];
    expect(shouldStop(history, 0.7)).toBeNull();
  });
  it('prefers all-pass over iteration-cap when both apply', () => {
    const history = [
      iter(1, 0, sum(0.5, { d1: 0.4 })),
      iter(2, 0.1, sum(0.6, { d1: 0.5 })),
      iter(3, 0.1, sum(0.7, { d1: 0.7 })),
      iter(4, 0.1, sum(0.8, { d1: 0.75 })),
      iter(5, 0.1, sum(0.9, { d1: 0.85 })),
    ];
    expect(shouldStop(history, 0.7)).toBe('all-pass');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/__tests__/triggers.test.ts`

Expected: FAIL — `Cannot find module '@/lib/agent/triggers'`.

- [ ] **Step 3: Implement triggers**

Create `src/lib/agent/triggers.ts`:

```ts
import type { AgentIteration, StopReason } from '@/lib/agent/types';
import type { Summary } from '@/lib/scoring';

const MAX_ITERATIONS = 5;
const NO_IMPROVEMENT_THRESHOLD = 0.05;

export function shouldTrigger(summary: Summary, threshold: number): boolean {
  if (summary.overall < threshold) return true;
  return Object.values(summary.perDimension).some((s) => s < threshold);
}

export function weakestDimension(summary: Summary): string | null {
  const entries = Object.entries(summary.perDimension);
  if (entries.length === 0) return null;
  return entries.reduce((min, cur) => (cur[1] < min[1] ? cur : min))[0];
}

function allPass(summary: Summary, threshold: number): boolean {
  if (summary.overall < threshold) return false;
  return Object.values(summary.perDimension).every((s) => s >= threshold);
}

export function shouldStop(history: AgentIteration[], threshold: number): StopReason | null {
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  if (allPass(latest.summaryAfter, threshold)) return 'all-pass';
  if (history.length >= MAX_ITERATIONS) return 'iteration-cap';
  if (history.length >= 2) {
    const prev = history[history.length - 2];
    if (
      latest.weakestDeltaSinceLast < NO_IMPROVEMENT_THRESHOLD &&
      prev.weakestDeltaSinceLast < NO_IMPROVEMENT_THRESHOLD
    ) {
      return 'no-improvement';
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/agent/__tests__/triggers.test.ts`

Expected: PASS, 9/9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/triggers.ts src/lib/agent/__tests__/triggers.test.ts
git commit -m "feat(agent): add trigger and stop predicates"
```

---

## Task 4: Extract runEval helper

**Files:**
- Create: `src/lib/runEval.ts`
- Test: `src/lib/__tests__/runEval.test.ts`
- Modify: `src/app/api/run-eval/route.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/runEval.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { generateJSON } from '@/lib/gemini';
import { runEval } from '@/lib/runEval';
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

const PARSED: ParsedSpec = {
  feature: 'f',
  inputs: [],
  outputs: [],
  constraints: [],
  domain: 'general',
};

const RUBRIC: Rubric = {
  dimensions: [
    { id: 'd1', label: 'D1', description: '', weight: 0.5 },
    { id: 'd2', label: 'D2', description: '', weight: 0.5 },
  ],
};

const TESTS: TestCase[] = [
  { id: 'test-01', category: 'happy_path', input: 'a' },
  { id: 'test-02', category: 'happy_path', input: 'b' },
];

describe('runEval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns results and a Summary for the given tests', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: 'ok',
      scores: [
        { dimensionId: 'd1', score: 0.9, reasoning: '' },
        { dimensionId: 'd2', score: 0.8, reasoning: '' },
      ],
    });
    const { results, summary } = await runEval(PARSED, RUBRIC, TESTS);
    expect(results).toHaveLength(2);
    expect(results[0].testId).toBe('test-01');
    expect(results[0].passed).toBe(true);
    expect(summary.overall).toBeCloseTo(0.85, 5);
    expect(summary.perDimension.d1).toBeCloseTo(0.9, 5);
  });

  it('substitutes empty results for tests that throw', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        output: 'ok',
        scores: [
          { dimensionId: 'd1', score: 0.9, reasoning: '' },
          { dimensionId: 'd2', score: 0.9, reasoning: '' },
        ],
      })
      .mockRejectedValueOnce(new Error('boom'));
    const { results, summary } = await runEval(PARSED, RUBRIC, TESTS);
    expect(results).toHaveLength(2);
    expect(results[1].output).toBe('');
    expect(results[1].passed).toBe(false);
    expect(summary).toBeDefined();
  });

  it('respects abort signal via runBatched', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runEval(PARSED, RUBRIC, TESTS, { signal: ac.signal })).rejects.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/__tests__/runEval.test.ts`

Expected: FAIL — `Cannot find module '@/lib/runEval'`.

- [ ] **Step 3: Implement runEval**

Create `src/lib/runEval.ts`:

```ts
import { generateJSON } from '@/lib/gemini';
import { runBatched } from '@/lib/runBatched';
import { buildRunEvalPrompt } from '@/lib/prompts';
import { summarize, weightedOverall } from '@/lib/scoring';
import type { Summary } from '@/lib/scoring';
import type { EvalResult, ParsedSpec, Rubric, TestCase } from '@/lib/types';

const PASS_THRESHOLD_DEFAULT = 0.7;

type RawJudge = {
  output?: unknown;
  scores?: { dimensionId: string; score: number; reasoning: string }[];
};

type RunEvalOptions = {
  signal?: AbortSignal;
  onProgress?: (completed: number, partial: ReadonlyArray<EvalResult | Error | undefined>) => void;
  concurrency?: number;
  gapMs?: number;
  passThreshold?: number;
};

export async function runEval(
  parsed: ParsedSpec,
  rubric: Rubric,
  tests: TestCase[],
  options: RunEvalOptions = {},
): Promise<{ results: EvalResult[]; summary: Summary }> {
  const passThreshold = options.passThreshold ?? PASS_THRESHOLD_DEFAULT;
  const concurrency = options.concurrency ?? 2;
  const gapMs = options.gapMs ?? 4000;

  const judgeOne = async (test: TestCase): Promise<EvalResult> => {
    const raw = await generateJSON<RawJudge>(buildRunEvalPrompt(parsed, rubric, test));
    const scores = raw.scores ?? [];
    const passedScore = weightedOverall(scores, rubric);
    const output =
      typeof raw.output === 'string'
        ? raw.output
        : raw.output == null
          ? ''
          : JSON.stringify(raw.output);
    return {
      testId: test.id,
      output,
      scores,
      passed: passedScore >= passThreshold,
    };
  };

  const partial = await runBatched<TestCase, EvalResult>(tests, judgeOne, {
    concurrency,
    gapMs,
    signal: options.signal,
    onProgress: options.onProgress,
  });

  const results: EvalResult[] = partial.map((r, i) =>
    r instanceof Error
      ? { testId: tests[i].id, output: '', scores: [], passed: false }
      : (r as EvalResult),
  );

  const summary = summarize(results, rubric, passThreshold);
  return { results, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/__tests__/runEval.test.ts`

Expected: PASS, 3/3 tests.

- [ ] **Step 5: Refactor /api/run-eval/route.ts to call runEval**

Read `src/app/api/run-eval/route.ts` first; replace lines 88-127 (the `judgeOne` definition and the `runBatched` call up through computing `summary`) with a single `runEval(...)` call. Edit:

```ts
// at top, replace existing imports of runBatched / scoring helpers as needed:
import { runEval } from '@/lib/runEval';
```

Replace the body of the try block in `start(controller)` from `const judgeOne = async ...` through `const summary = summarize(...)` with:

```ts
console.log(`[run-eval] starting batch: ${tests.length} tests, concurrency=2, gapMs=4000`);
const { results, summary } = await runEval(parsed, rubric, tests, {
  signal: req.signal,
  onProgress: (completed, p) => {
    lastSnapshot = { completed, partialResults: p };
  },
});
console.log(`[run-eval] batch resolved: ${results.length} results, ${results.filter((r) => r.scores.length === 0).length} errors`);
console.log(`[run-eval] emitting done: overall=${summary.overall.toFixed(3)}, passed=${summary.passedCount}/${results.length}`);
```

Remove now-unused imports (`runBatched`, `buildRunEvalPrompt`, `summarize`, `weightedOverall`, `generateJSON`, `RawJudge` type, `PASS_THRESHOLD_DEFAULT` constant). Keep the SSE plumbing, `safeEnqueue`, `stop`, `ticker`, `safeEnqueue({ type: 'done', ... })`.

- [ ] **Step 6: Run all tests to confirm no regression**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run`

Expected: all tests pass, including any existing `/api/run-eval` route tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/runEval.ts src/lib/__tests__/runEval.test.ts src/app/api/run-eval/route.ts
git commit -m "refactor(run-eval): extract runEval helper for agent reuse"
```

---

## Task 5: Tool registry skeleton

**Files:**
- Create: `src/lib/agent/tools/index.ts`
- Test: `src/lib/agent/tools/__tests__/index.test.ts`

This task wires up the registry shape. Each subsequent tool task adds one entry.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/tools/__tests__/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TOOL_NAMES } from '@/lib/agent/tools';
import type { ToolName } from '@/lib/agent/types';

describe('TOOL_NAMES', () => {
  it('includes all 7 tool names', () => {
    const expected: ToolName[] = [
      'diagnose_failures',
      'add_tests',
      'add_adversarial_tests',
      'revise_rubric',
      'tighten_rubric_descriptors',
      'rewrite_test',
      'rerun_eval',
    ];
    expect([...TOOL_NAMES].sort()).toEqual([...expected].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/tools/__tests__/index.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry skeleton**

Create `src/lib/agent/tools/index.ts`:

```ts
import type { ToolName } from '@/lib/agent/types';

// The canonical set of tool names. Used to typecheck the AI-SDK registry
// and to drive the planner prompt's "Available tools:" section.
export const TOOL_NAMES = [
  'diagnose_failures',
  'add_tests',
  'add_adversarial_tests',
  'revise_rubric',
  'tighten_rubric_descriptors',
  'rewrite_test',
  'rerun_eval',
] as const satisfies readonly ToolName[];

// Tool handlers return BOTH the public-facing result (shown to planner +
// transcript) and a partial state-update for the loop to merge.
export type ToolHandlerResult<TPublic> = {
  public: TPublic;
  stateUpdate: Partial<import('@/lib/agent/types').AgentState>;
};

// Each tool exports a `<name>Tool` AI-SDK descriptor object built with
// `tool({ description, inputSchema, execute })`. The registry is assembled
// once `buildToolRegistry()` is called below by the planner.
export type AgentToolContext = {
  state: import('@/lib/agent/types').AgentState;
  signal?: AbortSignal;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/agent/tools/__tests__/index.test.ts`

Expected: PASS, 1/1.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools/index.ts src/lib/agent/tools/__tests__/index.test.ts
git commit -m "feat(agent): add tool registry skeleton and shared types"
```

---

## Task 6: diagnose_failures tool

**Files:**
- Create: `src/lib/agent/tools/diagnose.ts`
- Test: `src/lib/agent/tools/__tests__/diagnose.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/tools/__tests__/diagnose.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { diagnoseFailures } from '@/lib/agent/tools/diagnose';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'legal' },
  tests: [
    { id: 'test-01', category: 'happy_path', input: 'a' },
    { id: 'test-02', category: 'edge_case', input: 'b' },
  ],
  rubric: {
    dimensions: [{ id: 'redline', label: 'Redline', description: 'desc', weight: 1.0 }],
  },
  results: [
    {
      testId: 'test-01',
      output: 'too vague',
      passed: false,
      scores: [{ dimensionId: 'redline', score: 0.3, reasoning: 'lacks specificity' }],
    },
    {
      testId: 'test-02',
      output: 'fine',
      passed: true,
      scores: [{ dimensionId: 'redline', score: 0.9, reasoning: 'good' }],
    },
  ],
  summary: { overall: 0.6, passedCount: 1, perDimension: { redline: 0.6 } },
};

describe('diagnoseFailures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns patterns and suggestions; does not mutate state', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      patterns: ['outputs lack specific clause references'],
      suggestedActions: ['tighten redline descriptor', 'add adversarial vague-redline tests'],
    });
    const out = await diagnoseFailures({ dimensionId: 'redline' }, { state: STATE });
    expect(out.public.patterns).toHaveLength(1);
    expect(out.public.suggestedActions).toHaveLength(2);
    expect(out.stateUpdate).toEqual({});
  });

  it('only sends failed cases for the target dimension to the LLM', async () => {
    const mock = generateJSON as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue({ patterns: [], suggestedActions: [] });
    await diagnoseFailures({ dimensionId: 'redline' }, { state: STATE });
    const prompt = mock.mock.calls[0][0] as string;
    expect(prompt).toContain('test-01');
    expect(prompt).not.toContain('test-02');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/agent/tools/__tests__/diagnose.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement diagnoseFailures**

Create `src/lib/agent/tools/diagnose.ts`:

```ts
import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';

export type DiagnoseFailuresInput = { dimensionId: string };
export type DiagnoseFailuresOutput = {
  patterns: string[];
  suggestedActions: string[];
};

const FAIL_THRESHOLD = 0.7;

function buildPrompt(
  dimensionId: string,
  failedCases: { testId: string; output: string; reasoning: string; score: number }[],
  domain: string,
): string {
  const cases = failedCases
    .map(
      (c, i) =>
        `Case ${i + 1} (${c.testId}, score ${c.score.toFixed(2)}):\n  Output: ${c.output}\n  Judge said: ${c.reasoning}`,
    )
    .join('\n\n');
  return `You are an evaluation diagnostician for a ${domain} feature. The dimension "${dimensionId}" is failing.

Failed cases on this dimension:
${cases}

Respond with ONLY a JSON object (no prose, no markdown) of this shape:

{
  "patterns": ["1-3 short failure patterns observed across the cases"],
  "suggestedActions": ["1-3 concrete actions: e.g. 'tighten the descriptor wording', 'add adversarial X tests', 'rewrite test-04'"]
}`;
}

export async function diagnoseFailures(
  input: DiagnoseFailuresInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<DiagnoseFailuresOutput>> {
  const failedCases = ctx.state.results
    .map((r) => {
      const s = r.scores.find((x) => x.dimensionId === input.dimensionId);
      if (!s || s.score >= FAIL_THRESHOLD) return null;
      return { testId: r.testId, output: r.output, reasoning: s.reasoning, score: s.score };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (failedCases.length === 0) {
    return { public: { patterns: [], suggestedActions: [] }, stateUpdate: {} };
  }

  const out = await generateJSON<DiagnoseFailuresOutput>(
    buildPrompt(input.dimensionId, failedCases, ctx.state.parsed.domain),
  );
  return { public: out, stateUpdate: {} };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/agent/tools/__tests__/diagnose.test.ts`

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools/diagnose.ts src/lib/agent/tools/__tests__/diagnose.test.ts
git commit -m "feat(agent): add diagnose_failures tool"
```

---

## Task 7: add_tests tool

**Files:**
- Create: `src/lib/agent/tools/addTests.ts`
- Test: `src/lib/agent/tools/__tests__/addTests.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/tools/__tests__/addTests.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { addTests } from '@/lib/agent/tools/addTests';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: ['i'], outputs: ['o'], constraints: [], domain: 'legal' },
  tests: [
    { id: 'test-01', category: 'happy_path', input: 'a' },
    { id: 'test-05', category: 'edge_case', input: 'b' },
  ],
  rubric: { dimensions: [{ id: 'd1', label: 'D1', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: {} },
};

describe('addTests', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends generated tests with ids continuing from current max', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'will-be-replaced-1', category: 'edge_case', input: 'new1' },
      { id: 'will-be-replaced-2', category: 'adversarial', input: 'new2' },
    ]);
    const out = await addTests({ n: 2 }, { state: STATE });
    expect(out.public.added).toHaveLength(2);
    expect(out.public.added.map((t) => t.id)).toEqual(['test-06', 'test-07']);
    expect(out.stateUpdate.tests).toHaveLength(4);
    expect(out.stateUpdate.tests?.[2].input).toBe('new1');
  });

  it('clamps n to the 1-10 range and trims excess generated tests', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({ id: 'x', category: 'happy_path', input: `g${i}` })),
    );
    const out = await addTests({ n: 99 }, { state: STATE });
    expect(out.public.added).toHaveLength(10);
  });

  it('mentions the focusDimensionId in the prompt when provided', async () => {
    const mock = generateJSON as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue([{ id: 'x', category: 'edge_case', input: 'q' }]);
    await addTests({ n: 1, focusDimensionId: 'redline' }, { state: STATE });
    const prompt = mock.mock.calls[0][0] as string;
    expect(prompt).toContain('redline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/tools/__tests__/addTests.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement addTests**

Create `src/lib/agent/tools/addTests.ts`:

```ts
import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';
import type { TestCase } from '@/lib/types';

export type AddTestsInput = { n: number; focusDimensionId?: string };
export type AddTestsOutput = { added: TestCase[] };

const MIN_N = 1;
const MAX_N = 10;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function nextIdNumber(tests: TestCase[]): number {
  const nums = tests
    .map((t) => Number(t.id.replace(/^test-/, '')))
    .filter((n) => Number.isFinite(n));
  return (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function buildPrompt(
  parsedDomain: string,
  feature: string,
  n: number,
  focusDimensionId?: string,
): string {
  const focus = focusDimensionId
    ? `\nFocus the new tests on surfacing failures for the rubric dimension "${focusDimensionId}".`
    : '';
  return `You are an evaluation engineer. Generate ${n} additional test cases for the AI feature below in the ${parsedDomain} domain.

Feature: ${feature}
${focus}

Each test must be realistic — write the input as a real user would phrase it, not as test scaffolding. Vary tone and length.

Respond with ONLY a JSON array (no prose, no markdown) of objects:

[
  { "id": "ignored", "category": "happy_path" | "edge_case" | "adversarial", "input": "the literal input", "notes": "optional 1-line reason" }
]

Generate exactly ${n} entries.`;
}

export async function addTests(
  input: AddTestsInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<AddTestsOutput>> {
  const n = clamp(input.n, MIN_N, MAX_N);
  const generated = await generateJSON<TestCase[]>(
    buildPrompt(ctx.state.parsed.domain, ctx.state.parsed.feature, n, input.focusDimensionId),
  );
  const trimmed = generated.slice(0, n);
  const start = nextIdNumber(ctx.state.tests);
  const added: TestCase[] = trimmed.map((t, i) => ({
    id: `test-${pad2(start + i)}`,
    category: t.category,
    input: t.input,
    notes: t.notes,
  }));
  return {
    public: { added },
    stateUpdate: { tests: [...ctx.state.tests, ...added] },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run src/lib/agent/tools/__tests__/addTests.test.ts`

Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools/addTests.ts src/lib/agent/tools/__tests__/addTests.test.ts
git commit -m "feat(agent): add add_tests tool with id continuation and clamping"
```

---

## Task 8: add_adversarial_tests tool

**Files:**
- Create: `src/lib/agent/tools/addAdversarial.ts`
- Test: `src/lib/agent/tools/__tests__/addAdversarial.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/tools/__tests__/addAdversarial.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { addAdversarialTests } from '@/lib/agent/tools/addAdversarial';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'healthcare' },
  tests: [{ id: 'test-01', category: 'happy_path', input: 'a' }],
  rubric: { dimensions: [{ id: 'd', label: 'D', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: {} },
};

describe('addAdversarialTests', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends 3-5 adversarial tests with continuing ids', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'x', category: 'adversarial', input: 'inj1' },
      { id: 'x', category: 'adversarial', input: 'inj2' },
      { id: 'x', category: 'adversarial', input: 'inj3' },
    ]);
    const out = await addAdversarialTests({ category: 'injection' }, { state: STATE });
    expect(out.public.added).toHaveLength(3);
    expect(out.public.added.every((t) => t.category === 'adversarial')).toBe(true);
    expect(out.public.added[0].id).toBe('test-02');
    expect(out.stateUpdate.tests).toHaveLength(4);
  });

  it('mentions the category in the prompt', async () => {
    const mock = generateJSON as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue([{ id: 'x', category: 'adversarial', input: 'q' }]);
    await addAdversarialTests({ category: 'out-of-scope' }, { state: STATE });
    const prompt = mock.mock.calls[0][0] as string;
    expect(prompt).toContain('out-of-scope');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/tools/__tests__/addAdversarial.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement addAdversarialTests**

Create `src/lib/agent/tools/addAdversarial.ts`:

```ts
import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';
import type { TestCase } from '@/lib/types';

export type AdversarialCategory =
  | 'injection'
  | 'edge-case'
  | 'ambiguous-input'
  | 'out-of-scope';

export type AddAdversarialTestsInput = { category: AdversarialCategory };
export type AddAdversarialTestsOutput = { added: TestCase[] };

const COUNT = 4;

function nextIdNumber(tests: TestCase[]): number {
  const nums = tests
    .map((t) => Number(t.id.replace(/^test-/, '')))
    .filter((n) => Number.isFinite(n));
  return (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function buildPrompt(domain: string, feature: string, category: AdversarialCategory): string {
  const flavor: Record<AdversarialCategory, string> = {
    'injection': 'prompt-injection attempts (instructions hidden in user content trying to override the system)',
    'edge-case': 'unusual but legal inputs that often trip the model (empty fields, very long content, multiple correct answers)',
    'ambiguous-input': 'inputs where the user intent is genuinely unclear or contradictory',
    'out-of-scope': 'inputs that look on-topic but are outside the feature\'s scope and should be politely declined',
  };
  return `You are an evaluation engineer. Generate ${COUNT} adversarial test cases for the AI feature below in the ${domain} domain.

Feature: ${feature}
Category: ${category} — ${flavor[category]}

Make the inputs realistic — what a real user would actually type or paste. No meta-language.

Respond with ONLY a JSON array (no prose, no markdown):

[
  { "id": "ignored", "category": "adversarial", "input": "the literal input", "notes": "optional 1-line reason" }
]

Generate exactly ${COUNT} entries.`;
}

export async function addAdversarialTests(
  input: AddAdversarialTestsInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<AddAdversarialTestsOutput>> {
  const generated = await generateJSON<TestCase[]>(
    buildPrompt(ctx.state.parsed.domain, ctx.state.parsed.feature, input.category),
  );
  const trimmed = generated.slice(0, COUNT);
  const start = nextIdNumber(ctx.state.tests);
  const added: TestCase[] = trimmed.map((t, i) => ({
    id: `test-${pad2(start + i)}`,
    category: 'adversarial',
    input: t.input,
    notes: t.notes,
  }));
  return {
    public: { added },
    stateUpdate: { tests: [...ctx.state.tests, ...added] },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/lib/agent/tools/__tests__/addAdversarial.test.ts`

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools/addAdversarial.ts src/lib/agent/tools/__tests__/addAdversarial.test.ts
git commit -m "feat(agent): add add_adversarial_tests tool"
```

---

## Task 9: revise_rubric tool

**Files:**
- Create: `src/lib/agent/tools/reviseRubric.ts`
- Test: `src/lib/agent/tools/__tests__/reviseRubric.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/tools/__tests__/reviseRubric.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { reviseRubric } from '@/lib/agent/tools/reviseRubric';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'legal' },
  tests: [],
  rubric: {
    dimensions: [
      { id: 'd1', label: 'D1', description: 'orig', weight: 0.5 },
      { id: 'd2', label: 'D2', description: 'orig', weight: 0.5 },
    ],
  },
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: { d1: 0.4, d2: 0.6 } },
};

describe('reviseRubric', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the revised rubric and lists changed dimension ids', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      dimensions: [
        { id: 'd1', label: 'D1', description: 'tighter', weight: 0.6 },
        { id: 'd2', label: 'D2', description: 'orig', weight: 0.4 },
      ],
    });
    const out = await reviseRubric({ reason: 'd1 too vague' }, { state: STATE });
    expect(out.public.changedDimensions.sort()).toEqual(['d1', 'd2']);
    expect(out.stateUpdate.rubric?.dimensions[0].description).toBe('tighter');
  });

  it('passes the reason to the prompt', async () => {
    const mock = generateJSON as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue({ dimensions: STATE.rubric.dimensions });
    await reviseRubric({ reason: 'specificity issue' }, { state: STATE });
    const prompt = mock.mock.calls[0][0] as string;
    expect(prompt).toContain('specificity issue');
  });

  it('reports no changes if the LLM returns the identical rubric', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      dimensions: STATE.rubric.dimensions,
    });
    const out = await reviseRubric({ reason: 'r' }, { state: STATE });
    expect(out.public.changedDimensions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/tools/__tests__/reviseRubric.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement reviseRubric**

Create `src/lib/agent/tools/reviseRubric.ts`:

```ts
import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';
import type { Rubric } from '@/lib/types';

export type ReviseRubricInput = { reason: string };
export type ReviseRubricOutput = { revisedRubric: Rubric; changedDimensions: string[] };

function buildPrompt(rubric: Rubric, reason: string, domain: string, perDim: Record<string, number>): string {
  return `You are revising a scoring rubric for a ${domain} feature. The recent eval surfaced this issue:

${reason}

Current per-dimension scores: ${JSON.stringify(perDim)}

Current rubric:
${JSON.stringify(rubric, null, 2)}

Produce a revised rubric. You may rewrite descriptions for clarity, adjust weights (must still sum to 1.0 ± 0.01), and reorder. Keep the same dimension ids; do not add or remove dimensions.

Respond with ONLY a JSON object matching:

{
  "dimensions": [
    { "id": "...", "label": "...", "description": "...", "weight": 0.0 }
  ]
}`;
}

function changedIds(before: Rubric, after: Rubric): string[] {
  const beforeById = new Map(before.dimensions.map((d) => [d.id, d]));
  const changed: string[] = [];
  for (const a of after.dimensions) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    if (b.description !== a.description || Math.abs(b.weight - a.weight) > 1e-9 || b.label !== a.label) {
      changed.push(a.id);
    }
  }
  return changed;
}

export async function reviseRubric(
  input: ReviseRubricInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<ReviseRubricOutput>> {
  const revised = await generateJSON<Rubric>(
    buildPrompt(ctx.state.rubric, input.reason, ctx.state.parsed.domain, ctx.state.summary.perDimension),
  );
  const changedDimensions = changedIds(ctx.state.rubric, revised);
  return {
    public: { revisedRubric: revised, changedDimensions },
    stateUpdate: { rubric: revised },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/lib/agent/tools/__tests__/reviseRubric.test.ts`

Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools/reviseRubric.ts src/lib/agent/tools/__tests__/reviseRubric.test.ts
git commit -m "feat(agent): add revise_rubric tool"
```

---

## Task 10: tighten_rubric_descriptors tool

**Files:**
- Create: `src/lib/agent/tools/tightenDescriptors.ts`
- Test: `src/lib/agent/tools/__tests__/tightenDescriptors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/tools/__tests__/tightenDescriptors.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { tightenRubricDescriptors } from '@/lib/agent/tools/tightenDescriptors';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'legal' },
  tests: [],
  rubric: {
    dimensions: [
      { id: 'redline', label: 'Redline', description: 'vague descriptor', weight: 0.5 },
      { id: 'risk', label: 'Risk', description: 'other', weight: 0.5 },
    ],
  },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: { redline: 0.4, risk: 0.8 } },
};

describe('tightenRubricDescriptors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates only the targeted dimension and returns before/after', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      description: 'a sharper, more specific descriptor',
    });
    const out = await tightenRubricDescriptors({ dimensionId: 'redline' }, { state: STATE });
    expect(out.public.before).toBe('vague descriptor');
    expect(out.public.after).toBe('a sharper, more specific descriptor');
    expect(out.stateUpdate.rubric?.dimensions.find((d) => d.id === 'redline')?.description).toBe(
      'a sharper, more specific descriptor',
    );
    expect(out.stateUpdate.rubric?.dimensions.find((d) => d.id === 'risk')?.description).toBe('other');
  });

  it('throws if the dimension id is unknown', async () => {
    await expect(
      tightenRubricDescriptors({ dimensionId: 'nonexistent' }, { state: STATE }),
    ).rejects.toThrow(/nonexistent/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/tools/__tests__/tightenDescriptors.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement tightenRubricDescriptors**

Create `src/lib/agent/tools/tightenDescriptors.ts`:

```ts
import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';

export type TightenRubricDescriptorsInput = { dimensionId: string };
export type TightenRubricDescriptorsOutput = { before: string; after: string };

function buildPrompt(label: string, description: string, score: number, domain: string): string {
  return `You are tightening one rubric dimension for a ${domain} feature. The dimension is currently scoring ${score.toFixed(2)} — below the 0.7 pass bar — likely because the descriptor is too vague.

Dimension: ${label}
Current descriptor: ${description}

Rewrite the descriptor to be sharper and more specific. Make the pass/fail line concrete. 1-3 sentences. No marketing language.

Respond with ONLY a JSON object: { "description": "..." }`;
}

export async function tightenRubricDescriptors(
  input: TightenRubricDescriptorsInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<TightenRubricDescriptorsOutput>> {
  const target = ctx.state.rubric.dimensions.find((d) => d.id === input.dimensionId);
  if (!target) {
    throw new Error(`Unknown rubric dimension id: ${input.dimensionId}`);
  }
  const score = ctx.state.summary.perDimension[input.dimensionId] ?? 0;
  const out = await generateJSON<{ description: string }>(
    buildPrompt(target.label, target.description, score, ctx.state.parsed.domain),
  );
  const updatedDimensions = ctx.state.rubric.dimensions.map((d) =>
    d.id === input.dimensionId ? { ...d, description: out.description } : d,
  );
  return {
    public: { before: target.description, after: out.description },
    stateUpdate: { rubric: { dimensions: updatedDimensions } },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/lib/agent/tools/__tests__/tightenDescriptors.test.ts`

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools/tightenDescriptors.ts src/lib/agent/tools/__tests__/tightenDescriptors.test.ts
git commit -m "feat(agent): add tighten_rubric_descriptors tool"
```

---

## Task 11: rewrite_test tool

**Files:**
- Create: `src/lib/agent/tools/rewriteTest.ts`
- Test: `src/lib/agent/tools/__tests__/rewriteTest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/tools/__tests__/rewriteTest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';
import { rewriteTest } from '@/lib/agent/tools/rewriteTest';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'legal' },
  tests: [
    { id: 'test-01', category: 'happy_path', input: 'orig' },
    { id: 'test-02', category: 'edge_case', input: 'keep' },
  ],
  rubric: { dimensions: [{ id: 'd', label: 'D', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: {} },
};

describe('rewriteTest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces the targeted test in place keeping the id', async () => {
    (generateJSON as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      category: 'edge_case',
      input: 'rewritten input',
      notes: 'tighter',
    });
    const out = await rewriteTest({ testId: 'test-01', reason: 'too soft' }, { state: STATE });
    expect(out.public.before.input).toBe('orig');
    expect(out.public.after.input).toBe('rewritten input');
    expect(out.public.after.id).toBe('test-01');
    expect(out.stateUpdate.tests).toHaveLength(2);
    expect(out.stateUpdate.tests?.[0].id).toBe('test-01');
    expect(out.stateUpdate.tests?.[0].input).toBe('rewritten input');
    expect(out.stateUpdate.tests?.[1].input).toBe('keep');
  });

  it('throws if the test id is unknown', async () => {
    await expect(
      rewriteTest({ testId: 'test-99', reason: 'x' }, { state: STATE }),
    ).rejects.toThrow(/test-99/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/tools/__tests__/rewriteTest.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement rewriteTest**

Create `src/lib/agent/tools/rewriteTest.ts`:

```ts
import { generateJSON } from '@/lib/gemini';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';
import type { TestCase } from '@/lib/types';

export type RewriteTestInput = { testId: string; reason: string };
export type RewriteTestOutput = { before: TestCase; after: TestCase };

function buildPrompt(test: TestCase, reason: string, domain: string): string {
  return `You are rewriting a test case for a ${domain} feature. The reason for the rewrite:

${reason}

Current test:
${JSON.stringify(test, null, 2)}

Produce a tighter, more realistic version. Same category. The input should read as something a real user would actually write — no test scaffolding language.

Respond with ONLY a JSON object: { "category": "happy_path" | "edge_case" | "adversarial", "input": "...", "notes": "optional" }`;
}

export async function rewriteTest(
  input: RewriteTestInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<RewriteTestOutput>> {
  const target = ctx.state.tests.find((t) => t.id === input.testId);
  if (!target) {
    throw new Error(`Unknown test id: ${input.testId}`);
  }
  const out = await generateJSON<Omit<TestCase, 'id'>>(
    buildPrompt(target, input.reason, ctx.state.parsed.domain),
  );
  const after: TestCase = { id: target.id, category: out.category, input: out.input, notes: out.notes };
  const updated = ctx.state.tests.map((t) => (t.id === target.id ? after : t));
  return { public: { before: target, after }, stateUpdate: { tests: updated } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/lib/agent/tools/__tests__/rewriteTest.test.ts`

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools/rewriteTest.ts src/lib/agent/tools/__tests__/rewriteTest.test.ts
git commit -m "feat(agent): add rewrite_test tool"
```

---

## Task 12: rerun_eval tool

**Files:**
- Create: `src/lib/agent/tools/rerunEval.ts`
- Test: `src/lib/agent/tools/__tests__/rerunEval.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/tools/__tests__/rerunEval.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/runEval', () => ({ runEval: vi.fn() }));

import { runEval } from '@/lib/runEval';
import { rerunEval } from '@/lib/agent/tools/rerunEval';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [{ id: 'test-01', category: 'happy_path', input: 'a' }],
  rubric: { dimensions: [{ id: 'd', label: 'D', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: {} },
};

describe('rerunEval', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls runEval with current parsed/rubric/tests and returns results+summary', async () => {
    const fakeResults = [{ testId: 'test-01', output: 'o', scores: [], passed: true }];
    const fakeSummary = { overall: 0.85, passedCount: 1, perDimension: { d: 0.9 } };
    (runEval as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: fakeResults,
      summary: fakeSummary,
    });
    const out = await rerunEval({}, { state: STATE });
    expect(runEval).toHaveBeenCalledWith(STATE.parsed, STATE.rubric, STATE.tests, expect.any(Object));
    expect(out.public.results).toBe(fakeResults);
    expect(out.public.summary).toBe(fakeSummary);
    expect(out.stateUpdate.results).toBe(fakeResults);
    expect(out.stateUpdate.summary).toBe(fakeSummary);
  });

  it('forwards the abort signal from context', async () => {
    const ac = new AbortController();
    (runEval as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [],
      summary: { overall: 0, passedCount: 0, perDimension: {} },
    });
    await rerunEval({}, { state: STATE, signal: ac.signal });
    const opts = (runEval as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(opts.signal).toBe(ac.signal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/tools/__tests__/rerunEval.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement rerunEval**

Create `src/lib/agent/tools/rerunEval.ts`:

```ts
import { runEval } from '@/lib/runEval';
import type { AgentToolContext, ToolHandlerResult } from '@/lib/agent/tools';
import type { EvalResult } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

export type RerunEvalInput = Record<string, never>;
export type RerunEvalOutput = { results: EvalResult[]; summary: Summary };

export async function rerunEval(
  _input: RerunEvalInput,
  ctx: AgentToolContext,
): Promise<ToolHandlerResult<RerunEvalOutput>> {
  const { results, summary } = await runEval(
    ctx.state.parsed,
    ctx.state.rubric,
    ctx.state.tests,
    { signal: ctx.signal },
  );
  return {
    public: { results, summary },
    stateUpdate: { results, summary },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/lib/agent/tools/__tests__/rerunEval.test.ts`

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools/rerunEval.ts src/lib/agent/tools/__tests__/rerunEval.test.ts
git commit -m "feat(agent): add rerun_eval tool"
```

---

## Task 13: AI-SDK tool registry

**Files:**
- Modify: `src/lib/agent/tools/index.ts`
- Test: `src/lib/agent/tools/__tests__/registry.test.ts`

This wraps each handler in AI SDK's `tool({ description, inputSchema, execute })`. The planner imports `buildToolRegistry(ctx)` to get the AI-SDK-shaped tool object keyed by tool name.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/tools/__tests__/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildToolRegistry } from '@/lib/agent/tools';
import type { AgentState } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [],
  rubric: { dimensions: [{ id: 'd', label: 'D', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0, passedCount: 0, perDimension: {} },
};

describe('buildToolRegistry', () => {
  it('returns an object keyed by all 7 tool names', () => {
    const registry = buildToolRegistry({ state: STATE });
    expect(Object.keys(registry).sort()).toEqual(
      [
        'add_adversarial_tests',
        'add_tests',
        'diagnose_failures',
        'rerun_eval',
        'revise_rubric',
        'rewrite_test',
        'tighten_rubric_descriptors',
      ],
    );
  });

  it('each entry has a description and inputSchema (AI-SDK shape)', () => {
    const registry = buildToolRegistry({ state: STATE });
    for (const [name, t] of Object.entries(registry)) {
      expect(t.description, `${name} missing description`).toBeTruthy();
      expect(t.inputSchema, `${name} missing inputSchema`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/tools/__tests__/registry.test.ts`

Expected: FAIL — `buildToolRegistry` not exported.

- [ ] **Step 3: Add buildToolRegistry**

Replace `src/lib/agent/tools/index.ts` contents:

```ts
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentState, ToolName } from '@/lib/agent/types';
import { diagnoseFailures } from '@/lib/agent/tools/diagnose';
import { addTests } from '@/lib/agent/tools/addTests';
import { addAdversarialTests } from '@/lib/agent/tools/addAdversarial';
import { reviseRubric } from '@/lib/agent/tools/reviseRubric';
import { tightenRubricDescriptors } from '@/lib/agent/tools/tightenDescriptors';
import { rewriteTest } from '@/lib/agent/tools/rewriteTest';
import { rerunEval } from '@/lib/agent/tools/rerunEval';

export const TOOL_NAMES = [
  'diagnose_failures',
  'add_tests',
  'add_adversarial_tests',
  'revise_rubric',
  'tighten_rubric_descriptors',
  'rewrite_test',
  'rerun_eval',
] as const satisfies readonly ToolName[];

export type ToolHandlerResult<TPublic> = {
  public: TPublic;
  stateUpdate: Partial<AgentState>;
};

export type AgentToolContext = {
  state: AgentState;
  signal?: AbortSignal;
};

// Build the AI-SDK tool registry bound to a specific agent context.
// The planner calls this once per iteration with the latest state.
export function buildToolRegistry(ctx: AgentToolContext) {
  return {
    diagnose_failures: tool({
      description:
        'Read-only. Analyze the failed cases for one rubric dimension and return common failure patterns plus suggested next actions.',
      inputSchema: z.object({ dimensionId: z.string() }),
      execute: async (args) => diagnoseFailures(args, ctx),
    }),
    add_tests: tool({
      description:
        'Generate and append n new test cases (1-10). Optionally focus on a specific rubric dimension.',
      inputSchema: z.object({
        n: z.number().int().min(1).max(10),
        focusDimensionId: z.string().optional(),
      }),
      execute: async (args) => addTests(args, ctx),
    }),
    add_adversarial_tests: tool({
      description:
        'Generate 4 adversarial test cases of a given category and append them to the test suite.',
      inputSchema: z.object({
        category: z.enum(['injection', 'edge-case', 'ambiguous-input', 'out-of-scope']),
      }),
      execute: async (args) => addAdversarialTests(args, ctx),
    }),
    revise_rubric: tool({
      description:
        'Revise the entire rubric (descriptions and weights) given a reason. Same dimension ids preserved.',
      inputSchema: z.object({ reason: z.string() }),
      execute: async (args) => reviseRubric(args, ctx),
    }),
    tighten_rubric_descriptors: tool({
      description:
        'Tighten the descriptor of a single rubric dimension to make pass/fail more concrete.',
      inputSchema: z.object({ dimensionId: z.string() }),
      execute: async (args) => tightenRubricDescriptors(args, ctx),
    }),
    rewrite_test: tool({
      description:
        'Rewrite one test case in place (id preserved) given a reason — typically because the current input is too soft or unclear.',
      inputSchema: z.object({ testId: z.string(), reason: z.string() }),
      execute: async (args) => rewriteTest(args, ctx),
    }),
    rerun_eval: tool({
      description:
        'Re-run the evaluation against the current tests + rubric. Always call this after a mutation before deciding the next action.',
      inputSchema: z.object({}),
      execute: async (args) => rerunEval(args, ctx),
    }),
  };
}
```

- [ ] **Step 4: Run all tool tests to verify nothing regressed**

Run: `pnpm test:run src/lib/agent/tools`

Expected: every test in the tools dir passes (registry test passes too).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/tools/index.ts src/lib/agent/tools/__tests__/registry.test.ts
git commit -m "feat(agent): wire AI-SDK tool registry"
```

---

## Task 14: Planner

**Files:**
- Create: `src/lib/agent/planner.ts`
- Test: `src/lib/agent/__tests__/planner.test.ts`

The planner calls AI SDK's `generateText({ model, tools, messages })` once per iteration. AI SDK invokes the matching tool's `execute` and returns the tool result. The planner returns `{ toolName, args, public, stateUpdate }` for the loop to process.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/__tests__/planner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  tool: (def: unknown) => def,
  stepCountIs: (n: number) => ({ kind: 'stepCountIs', n }),
}));

vi.mock('@/lib/runEval', () => ({ runEval: vi.fn() }));
vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateText } from 'ai';
import { buildPlannerPrompt, callPlanner } from '@/lib/agent/planner';
import type { AgentState, AgentIteration } from '@/lib/agent/types';

const STATE: AgentState = {
  parsed: { feature: 'Contract redline', inputs: [], outputs: [], constraints: [], domain: 'legal' },
  tests: [{ id: 'test-01', category: 'happy_path', input: 'a' }],
  rubric: { dimensions: [{ id: 'redline', label: 'Redline', description: '', weight: 1 }] },
  results: [],
  summary: { overall: 0.4, passedCount: 0, perDimension: { redline: 0.4 } },
};

describe('buildPlannerPrompt', () => {
  it('includes domain, overall score, per-dimension scores, iteration counter', () => {
    const prompt = buildPlannerPrompt({
      state: STATE,
      history: [],
      iteration: 2,
      maxIterations: 5,
      threshold: 0.7,
    });
    expect(prompt).toContain('legal');
    expect(prompt).toContain('0.4');
    expect(prompt).toContain('redline');
    expect(prompt).toContain('Iteration: 2 / 5');
    expect(prompt).toContain('0.7');
  });

  it('renders recent history with tool name and weakest delta', () => {
    const history: AgentIteration[] = [
      {
        iteration: 1,
        toolName: 'add_tests',
        args: { n: 3 },
        result: { added: [] },
        summaryAfter: STATE.summary,
        weakestDeltaSinceLast: 0,
      },
    ];
    const prompt = buildPlannerPrompt({
      state: STATE,
      history,
      iteration: 2,
      maxIterations: 5,
      threshold: 0.7,
    });
    expect(prompt).toContain('add_tests');
  });
});

describe('callPlanner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes generateText with the model and tools and returns the chosen tool call', async () => {
    (generateText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      steps: [
        {
          toolCalls: [{ toolName: 'diagnose_failures', input: { dimensionId: 'redline' } }],
          toolResults: [
            {
              toolName: 'diagnose_failures',
              output: { public: { patterns: ['vague'], suggestedActions: [] }, stateUpdate: {} },
            },
          ],
        },
      ],
    });
    const out = await callPlanner({
      state: STATE,
      history: [],
      iteration: 1,
      maxIterations: 5,
      threshold: 0.7,
    });
    expect(out.toolName).toBe('diagnose_failures');
    expect(out.args).toEqual({ dimensionId: 'redline' });
    expect(out.public).toEqual({ patterns: ['vague'], suggestedActions: [] });
    expect(out.stateUpdate).toEqual({});
  });

  it('throws if generateText returned no tool call', async () => {
    (generateText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      steps: [{ toolCalls: [], toolResults: [] }],
    });
    await expect(
      callPlanner({
        state: STATE,
        history: [],
        iteration: 1,
        maxIterations: 5,
        threshold: 0.7,
      }),
    ).rejects.toThrow(/no tool call/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/__tests__/planner.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement planner**

Create `src/lib/agent/planner.ts`:

```ts
import { generateText, stepCountIs } from 'ai';
import type { AgentState, AgentIteration, ToolName, StateUpdate } from '@/lib/agent/types';
import { buildToolRegistry } from '@/lib/agent/tools';

const PLANNER_MODEL = 'google/gemini-2.5-pro';

type CallPlannerInput = {
  state: AgentState;
  history: AgentIteration[];
  iteration: number;
  maxIterations: number;
  threshold: number;
  signal?: AbortSignal;
};

export type PlannerResult = {
  toolName: ToolName;
  args: unknown;
  public: unknown;
  stateUpdate: StateUpdate;
};

export function buildPlannerPrompt(input: Omit<CallPlannerInput, 'signal'>): string {
  const { state, history, iteration, maxIterations, threshold } = input;
  const dims = Object.entries(state.summary.perDimension)
    .map(([id, score]) => `  ${id}: ${score.toFixed(2)}`)
    .join('\n');
  const recent = history
    .slice(-3)
    .map(
      (h) =>
        `  iter ${h.iteration}: ${h.toolName}(${JSON.stringify(h.args)}) → overall=${h.summaryAfter.overall.toFixed(2)}, weakestDelta=${h.weakestDeltaSinceLast.toFixed(2)}`,
    )
    .join('\n');

  return `You are an evaluation-improvement agent. The user just ran an evaluation on an AI feature and the score is below the pass threshold. Your job: pick the next tool that will most likely improve the weakest rubric dimensions.

Spec
- Feature: ${state.parsed.feature}
- Domain: ${state.parsed.domain}

Current evaluation state
- Overall score: ${state.summary.overall.toFixed(2)}
- Pass threshold: ${threshold}
- Per-dimension scores:
${dims || '  (no dimensions)'}
- Test count: ${state.tests.length}

Iteration: ${iteration} / ${maxIterations}

Recent history (most recent last):
${recent || '  (none)'}

Strategy guidance
- If you have not diagnosed the weakest dimension yet, call diagnose_failures first.
- After ANY mutation tool, call rerun_eval before deciding the next mutation. Without rerun_eval, you cannot tell if the change helped.
- Avoid repeating the same tool call back-to-back unless you have new information.
- Prefer rubric tightening when descriptors are vague; prefer add_adversarial_tests when the suite lacks coverage; prefer rewrite_test when one specific test is the outlier.

Choose ONE tool to call now.`;
}

export async function callPlanner(input: CallPlannerInput): Promise<PlannerResult> {
  const tools = buildToolRegistry({ state: input.state, signal: input.signal });
  const result = await generateText({
    model: PLANNER_MODEL,
    tools,
    stopWhen: stepCountIs(1),
    messages: [
      { role: 'user', content: buildPlannerPrompt(input) },
    ],
    abortSignal: input.signal,
  });

  const step = result.steps[result.steps.length - 1];
  const call = step?.toolCalls?.[0];
  const res = step?.toolResults?.[0];
  if (!call || !res) {
    throw new Error('Planner returned no tool call');
  }
  const output = res.output as { public: unknown; stateUpdate: StateUpdate };
  return {
    toolName: call.toolName as ToolName,
    args: call.input,
    public: output.public,
    stateUpdate: output.stateUpdate,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/lib/agent/__tests__/planner.test.ts`

Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/planner.ts src/lib/agent/__tests__/planner.test.ts
git commit -m "feat(agent): add planner with AI-SDK generateText + tool calling"
```

---

## Task 15: Agent loop

**Files:**
- Create: `src/lib/agent/loop.ts`
- Test: `src/lib/agent/__tests__/loop.test.ts`

The loop is a pure async generator. The route adapts it to SSE; tests iterate it directly.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/__tests__/loop.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agent/planner', () => ({ callPlanner: vi.fn() }));

import { callPlanner } from '@/lib/agent/planner';
import { runAgentLoop } from '@/lib/agent/loop';
import type { AgentEvent, AgentState } from '@/lib/agent/types';

const baseState = (overall: number, perDim: Record<string, number>): AgentState => ({
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [{ id: 'test-01', category: 'happy_path', input: 'a' }],
  rubric: { dimensions: [{ id: 'd1', label: 'D1', description: '', weight: 1 }] },
  results: [],
  summary: { overall, passedCount: 0, perDimension: perDim },
});

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('runAgentLoop', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits started, iteration events, loop-end, and committed for an all-pass run', async () => {
    (callPlanner as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolName: 'rerun_eval',
      args: {},
      public: { results: [], summary: { overall: 0.9, passedCount: 1, perDimension: { d1: 0.9 } } },
      stateUpdate: { results: [], summary: { overall: 0.9, passedCount: 1, perDimension: { d1: 0.9 } } },
    });
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.7, maxIterations: 5 },
        new AbortController().signal,
      ),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain('started');
    expect(types).toContain('iteration-start');
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types).toContain('iteration-end');
    expect(types).toContain('loop-end');
    expect(types).toContain('committed');
    const loopEnd = events.find((e) => e.type === 'loop-end')!;
    if (loopEnd.type === 'loop-end') expect(loopEnd.reason).toBe('all-pass');
  });

  it('emits rolled-back when final overall regresses below the snapshot', async () => {
    (callPlanner as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolName: 'rerun_eval',
      args: {},
      public: { results: [], summary: { overall: 0.3, passedCount: 0, perDimension: { d1: 0.3 } } },
      stateUpdate: { results: [], summary: { overall: 0.3, passedCount: 0, perDimension: { d1: 0.3 } } },
    });
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.7, maxIterations: 2 },
        new AbortController().signal,
      ),
    );
    expect(events.some((e) => e.type === 'rolled-back')).toBe(true);
    expect(events.some((e) => e.type === 'committed')).toBe(false);
  });

  it('stops at iteration cap when no all-pass and no no-improvement triggered', async () => {
    let i = 0;
    (callPlanner as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      i++;
      const overall = 0.5 + i * 0.05; // small but consistent improvement
      return {
        toolName: 'rerun_eval',
        args: {},
        public: {},
        stateUpdate: {
          summary: { overall, passedCount: 0, perDimension: { d1: overall } },
        },
      };
    });
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.99, maxIterations: 5 },
        new AbortController().signal,
      ),
    );
    const loopEnd = events.find((e) => e.type === 'loop-end');
    if (loopEnd?.type === 'loop-end') expect(loopEnd.reason).toBe('iteration-cap');
  });

  it('aborts cleanly when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.7, maxIterations: 5 },
        ac.signal,
      ),
    );
    expect(events.some((e) => e.type === 'aborted')).toBe(true);
  });

  it('emits error and exits if a tool throws', async () => {
    (callPlanner as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const events = await collect(
      runAgentLoop(
        { ...baseState(0.5, { d1: 0.5 }), threshold: 0.7, maxIterations: 5 },
        new AbortController().signal,
      ),
    );
    const err = events.find((e) => e.type === 'error');
    expect(err?.type === 'error' && err.message).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/agent/__tests__/loop.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement runAgentLoop**

Create `src/lib/agent/loop.ts`:

```ts
import { takeSnapshot, diffSnapshots } from '@/lib/agent/snapshot';
import { shouldStop, weakestDimension } from '@/lib/agent/triggers';
import { callPlanner } from '@/lib/agent/planner';
import type {
  AgentEvent,
  AgentIteration,
  AgentState,
  Snapshot,
  StateUpdate,
  StopReason,
} from '@/lib/agent/types';

type LoopInput = AgentState & { threshold: number; maxIterations: number };

function applyStateUpdate(state: AgentState, update: StateUpdate): AgentState {
  return {
    parsed: state.parsed,
    tests: update.tests ?? state.tests,
    rubric: update.rubric ?? state.rubric,
    results: update.results ?? state.results,
    summary: update.summary ?? state.summary,
  };
}

function computeWeakestDelta(history: AgentIteration[], current: AgentState): number {
  if (history.length === 0) return 0;
  const prev = history[history.length - 1].summaryAfter;
  const weakestId = weakestDimension(current.summary);
  if (!weakestId) return 0;
  const before = prev.perDimension[weakestId] ?? 0;
  const after = current.summary.perDimension[weakestId] ?? 0;
  return after - before;
}

export async function* runAgentLoop(
  input: LoopInput,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const startSnap: Snapshot = takeSnapshot({
    parsed: input.parsed,
    tests: input.tests,
    rubric: input.rubric,
    results: input.results,
    summary: input.summary,
  });
  yield {
    type: 'started',
    snapshot: startSnap,
    threshold: input.threshold,
    maxIterations: input.maxIterations,
  };

  if (signal.aborted) {
    yield { type: 'aborted' };
    return;
  }

  let state: AgentState = {
    parsed: input.parsed,
    tests: input.tests,
    rubric: input.rubric,
    results: input.results,
    summary: input.summary,
  };
  const history: AgentIteration[] = [];
  let stoppedReason: StopReason | null = null;

  for (let i = 1; i <= input.maxIterations; i++) {
    if (signal.aborted) {
      yield { type: 'aborted' };
      return;
    }
    yield { type: 'iteration-start', iteration: i };
    yield { type: 'planner-thinking', iteration: i };

    let plan: Awaited<ReturnType<typeof callPlanner>>;
    try {
      plan = await callPlanner({
        state,
        history,
        iteration: i,
        maxIterations: input.maxIterations,
        threshold: input.threshold,
        signal,
      });
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      return;
    }

    yield { type: 'tool-call', iteration: i, name: plan.toolName, args: plan.args };
    state = applyStateUpdate(state, plan.stateUpdate);
    yield { type: 'tool-result', iteration: i, name: plan.toolName, result: plan.public };

    const iter: AgentIteration = {
      iteration: i,
      toolName: plan.toolName,
      args: plan.args,
      result: plan.public,
      summaryAfter: state.summary,
      weakestDeltaSinceLast: computeWeakestDelta(history, state),
    };
    history.push(iter);

    const reason = shouldStop(history, input.threshold);
    yield { type: 'iteration-end', iteration: i };
    if (reason) {
      stoppedReason = reason;
      break;
    }
  }

  yield {
    type: 'loop-end',
    reason: stoppedReason ?? 'iteration-cap',
    finalSummary: state.summary,
  };

  if (state.summary.overall < startSnap.summary.overall) {
    yield { type: 'rolled-back', reason: 'overall-regressed', restored: startSnap };
  } else {
    const after = takeSnapshot(state);
    yield { type: 'committed', finalState: state, diff: diffSnapshots(startSnap, after) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/lib/agent/__tests__/loop.test.ts`

Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/loop.ts src/lib/agent/__tests__/loop.test.ts
git commit -m "feat(agent): add bounded loop with snapshot + auto-rollback"
```

---

## Task 16: /api/improve SSE route

**Files:**
- Create: `src/app/api/improve/route.ts`
- Test: `src/app/api/improve/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/improve/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agent/loop', () => ({
  runAgentLoop: vi.fn(),
}));

import { runAgentLoop } from '@/lib/agent/loop';
import { POST } from '@/app/api/improve/route';
import type { AgentEvent } from '@/lib/agent/types';

const validBody = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  rubric: { dimensions: [{ id: 'd', label: 'D', description: '', weight: 1 }] },
  tests: [{ id: 'test-01', category: 'happy_path', input: 'a' }],
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: { d: 0.5 } },
};

async function readSSE(res: Response): Promise<AgentEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events: AgentEvent[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }
  return events;
}

describe('POST /api/improve', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 on invalid body', async () => {
    const req = new Request('http://localhost/api/improve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parsed: 'nope' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('streams agent events on valid body', async () => {
    (runAgentLoop as unknown as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield { type: 'started', snapshot: {}, threshold: 0.7, maxIterations: 5 } as AgentEvent;
      yield { type: 'iteration-start', iteration: 1 } as AgentEvent;
      yield {
        type: 'committed',
        finalState: {} as never,
        diff: {} as never,
      } as AgentEvent;
    });
    const req = new Request('http://localhost/api/improve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await readSSE(res);
    expect(events.map((e) => e.type)).toEqual(['started', 'iteration-start', 'committed']);
  });

  it('emits error frame if loop throws', async () => {
    (runAgentLoop as unknown as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield { type: 'started', snapshot: {}, threshold: 0.7, maxIterations: 5 } as AgentEvent;
      throw new Error('loop crash');
    });
    const req = new Request('http://localhost/api/improve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    const events = await readSSE(res);
    expect(events.some((e) => e.type === 'error' && /loop crash/.test(e.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/app/api/improve/__tests__/route.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/improve/route.ts`:

```ts
import { runAgentLoop } from '@/lib/agent/loop';
import type { AgentEvent } from '@/lib/agent/types';
import type { EvalResult, ParsedSpec, Rubric, TestCase } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

const enc = new TextEncoder();
const frame = (e: AgentEvent) => enc.encode(`data: ${JSON.stringify(e)}\n\n`);

function isParsed(x: unknown): x is ParsedSpec {
  return !!x && typeof x === 'object'
    && 'feature' in x && typeof (x as { feature: unknown }).feature === 'string'
    && 'domain' in x;
}
function isRubric(x: unknown): x is Rubric {
  return !!x && typeof x === 'object'
    && Array.isArray((x as { dimensions?: unknown }).dimensions);
}
function isTests(x: unknown): x is TestCase[] {
  return Array.isArray(x)
    && x.every((t) => t && typeof t === 'object' && 'id' in t && 'input' in t);
}
function isResults(x: unknown): x is EvalResult[] {
  return Array.isArray(x)
    && x.every((r) => r && typeof r === 'object' && 'testId' in r && 'scores' in r);
}
function isSummary(x: unknown): x is Summary {
  return !!x && typeof x === 'object'
    && typeof (x as { overall?: unknown }).overall === 'number'
    && typeof (x as { perDimension?: unknown }).perDimension === 'object';
}

export async function POST(req: Request): Promise<Response> {
  let body: {
    parsed?: unknown;
    rubric?: unknown;
    tests?: unknown;
    results?: unknown;
    summary?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (
    !isParsed(body.parsed)
    || !isRubric(body.rubric)
    || !isTests(body.tests)
    || !isResults(body.results)
    || !isSummary(body.summary)
  ) {
    return new Response(JSON.stringify({ error: 'invalid body shape' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (e: AgentEvent) => {
        if (closed) return;
        try { controller.enqueue(frame(e)); } catch { /* torn down */ }
      };
      try {
        for await (const event of runAgentLoop(
          {
            parsed: body.parsed as ParsedSpec,
            tests: body.tests as TestCase[],
            rubric: body.rubric as Rubric,
            results: body.results as EvalResult[],
            summary: body.summary as Summary,
            threshold: 0.7,
            maxIterations: 5,
          },
          req.signal,
        )) {
          safeEnqueue(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        safeEnqueue({ type: 'error', message });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/app/api/improve/__tests__/route.test.ts`

Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/improve/route.ts src/app/api/improve/__tests__/route.test.ts
git commit -m "feat(agent): add /api/improve SSE route"
```

---

## Task 17: pageReducer additions

**Files:**
- Modify: `src/lib/pageReducer.ts`
- Test: `src/lib/__tests__/pageReducer-improve.test.ts`

Adds an `improve` stage. Different shape from the other stages because it carries snapshot + diff + multi-phase outcome rather than a plain `current: T`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/pageReducer-improve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialState, reducer } from '@/lib/pageReducer';
import type { AgentEvent, Snapshot, SnapshotDiff, AgentState } from '@/lib/agent/types';

const SNAP: Snapshot = {
  tests: [],
  rubric: { dimensions: [] },
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: {} },
};

const DIFF: SnapshotDiff = {
  testsAdded: [],
  testsRemoved: [],
  testsChanged: [],
  rubricDimensionsChanged: [],
  overallDelta: 0.2,
  perDimensionDelta: [],
};

const FINAL: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [],
  rubric: { dimensions: [] },
  results: [],
  summary: { overall: 0.7, passedCount: 0, perDimension: {} },
};

describe('improve stage in pageReducer', () => {
  it('starts in idle phase', () => {
    expect(initialState.stages.improve.phase).toBe('idle');
  });

  it('IMPROVE_START transitions to running and clears events', () => {
    const next = reducer(initialState, { type: 'IMPROVE_START' });
    expect(next.stages.improve.phase).toBe('running');
    if (next.stages.improve.phase === 'running') {
      expect(next.stages.improve.events).toEqual([]);
      expect(next.stages.improve.snapshot).toBeNull();
    }
  });

  it('IMPROVE_EVENT(started) records the snapshot', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const event: AgentEvent = { type: 'started', snapshot: SNAP, threshold: 0.7, maxIterations: 5 };
    const b = reducer(a, { type: 'IMPROVE_EVENT', event });
    if (b.stages.improve.phase === 'running') {
      expect(b.stages.improve.snapshot).toEqual(SNAP);
      expect(b.stages.improve.events).toHaveLength(1);
    }
  });

  it('IMPROVE_EVENT(committed) transitions to done-committed', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const event: AgentEvent = { type: 'committed', finalState: FINAL, diff: DIFF };
    const b = reducer(a, { type: 'IMPROVE_EVENT', event });
    expect(b.stages.improve.phase).toBe('done-committed');
    if (b.stages.improve.phase === 'done-committed') {
      expect(b.stages.improve.diff).toEqual(DIFF);
      expect(b.stages.improve.finalState).toEqual(FINAL);
    }
  });

  it('IMPROVE_EVENT(rolled-back) transitions to done-rolled-back', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const e1: AgentEvent = { type: 'started', snapshot: SNAP, threshold: 0.7, maxIterations: 5 };
    const b = reducer(a, { type: 'IMPROVE_EVENT', event: e1 });
    const e2: AgentEvent = { type: 'rolled-back', reason: 'overall-regressed', restored: SNAP };
    const c = reducer(b, { type: 'IMPROVE_EVENT', event: e2 });
    expect(c.stages.improve.phase).toBe('done-rolled-back');
    if (c.stages.improve.phase === 'done-rolled-back') {
      expect(c.stages.improve.restored).toEqual(SNAP);
    }
  });

  it('IMPROVE_EVENT(error) transitions to error and records the message', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const event: AgentEvent = { type: 'error', message: 'planner failed' };
    const b = reducer(a, { type: 'IMPROVE_EVENT', event });
    expect(b.stages.improve.phase).toBe('error');
    if (b.stages.improve.phase === 'error') expect(b.stages.improve.message).toBe('planner failed');
  });

  it('IMPROVE_RESET returns improve stage to idle', () => {
    const a = reducer(initialState, { type: 'IMPROVE_START' });
    const b = reducer(a, { type: 'IMPROVE_RESET' });
    expect(b.stages.improve.phase).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/lib/__tests__/pageReducer-improve.test.ts`

Expected: FAIL — `initialState.stages.improve` does not exist.

- [ ] **Step 3: Modify pageReducer.ts to add the improve stage**

Edit `src/lib/pageReducer.ts`. Add imports and types at the top after the existing imports:

```ts
import type { AgentEvent, AgentState, Snapshot, SnapshotDiff } from '@/lib/agent/types';

export type ImproveStageState =
  | { phase: 'idle' }
  | { phase: 'running'; events: AgentEvent[]; snapshot: Snapshot | null }
  | { phase: 'done-committed'; events: AgentEvent[]; snapshot: Snapshot; finalState: AgentState; diff: SnapshotDiff }
  | { phase: 'done-rolled-back'; events: AgentEvent[]; snapshot: Snapshot; restored: Snapshot }
  | { phase: 'error'; events: AgentEvent[]; snapshot: Snapshot | null; message: string };
```

Update `StageKey` to include `'improve'`:

```ts
export type StageKey = 'parse' | 'tests' | 'rubric' | 'run' | 'improve';
```

Add `improve` to `PageState.stages`:

```ts
export type PageState = {
  spec: string;
  stages: {
    parse: StageState<ParsedSpec>;
    tests: StageState<TestCase[]>;
    rubric: StageState<Rubric>;
    run: StageState<RunSnapshot>;
    improve: ImproveStageState;
  };
  error: { stage: StageKey; message: string; recoverable: boolean } | null;
};
```

Add three new actions to `PageAction`:

```ts
export type PageAction =
  | { type: 'STAGE_START'; stage: StageKey }
  | { type: 'STAGE_EVENT'; stage: StageKey; event: RefinementEvent<unknown> }
  | { type: 'STAGE_RUN_EVENT'; event: RunEvent }
  | { type: 'STAGE_ERR'; stage: StageKey; message: string; recoverable: boolean }
  | { type: 'PIPELINE_START'; spec: string }
  | { type: 'IMPROVE_START' }
  | { type: 'IMPROVE_EVENT'; event: AgentEvent }
  | { type: 'IMPROVE_RESET' }
  | { type: 'RESET' };
```

Update `initialState.stages` to include `improve: { phase: 'idle' }`.

Add reducer cases (place inside the `switch (action.type)` in `reducer`, before the default):

```ts
case 'IMPROVE_START': {
  return {
    ...state,
    stages: {
      ...state.stages,
      improve: { phase: 'running', events: [], snapshot: null },
    },
    error: null,
  };
}
case 'IMPROVE_EVENT': {
  const cur = state.stages.improve;
  const events = cur.phase === 'idle' ? [action.event] : [...(cur as { events?: AgentEvent[] }).events ?? [], action.event];
  const snapshot =
    action.event.type === 'started'
      ? action.event.snapshot
      : cur.phase === 'idle'
        ? null
        : (cur as { snapshot?: Snapshot | null }).snapshot ?? null;

  let next: ImproveStageState = { phase: 'running', events, snapshot };
  if (action.event.type === 'committed') {
    next = {
      phase: 'done-committed',
      events,
      snapshot: snapshot as Snapshot,
      finalState: action.event.finalState,
      diff: action.event.diff,
    };
  } else if (action.event.type === 'rolled-back') {
    next = {
      phase: 'done-rolled-back',
      events,
      snapshot: snapshot as Snapshot,
      restored: action.event.restored,
    };
  } else if (action.event.type === 'error') {
    next = {
      phase: 'error',
      events,
      snapshot,
      message: action.event.message,
    };
  }
  return { ...state, stages: { ...state.stages, improve: next } };
}
case 'IMPROVE_RESET': {
  return { ...state, stages: { ...state.stages, improve: { phase: 'idle' } } };
}
```

Also add `improve: { phase: 'idle' }` into the `PIPELINE_START` and `RESET` reset paths so the improve stage clears with the rest of the pipeline.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/lib/__tests__/pageReducer-improve.test.ts`

Expected: PASS, 7/7.

- [ ] **Step 5: Run all tests to confirm no regression**

Run: `cd /Users/siddharthagrawal/evalforge && pnpm test:run`

Expected: every test passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pageReducer.ts src/lib/__tests__/pageReducer-improve.test.ts
git commit -m "feat(agent): add improve stage to pageReducer"
```

---

## Task 18: AgentTranscript component

**Files:**
- Create: `src/components/AgentTranscript.tsx`
- Test: `src/components/__tests__/AgentTranscript.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/AgentTranscript.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentTranscript from '@/components/AgentTranscript';
import type { AgentEvent, Snapshot, SnapshotDiff, AgentState } from '@/lib/agent/types';

const SNAP: Snapshot = {
  tests: [],
  rubric: { dimensions: [] },
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: {} },
};
const DIFF: SnapshotDiff = {
  testsAdded: [], testsRemoved: [], testsChanged: [], rubricDimensionsChanged: [],
  overallDelta: 0, perDimensionDelta: [],
};
const FINAL: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [], rubric: { dimensions: [] }, results: [],
  summary: { overall: 0.7, passedCount: 0, perDimension: {} },
};

const events: AgentEvent[] = [
  { type: 'started', snapshot: SNAP, threshold: 0.7, maxIterations: 5 },
  { type: 'iteration-start', iteration: 1 },
  { type: 'tool-call', iteration: 1, name: 'diagnose_failures', args: { dimensionId: 'redline' } },
  { type: 'tool-result', iteration: 1, name: 'diagnose_failures', result: { patterns: ['vague'], suggestedActions: [] } },
  { type: 'iteration-end', iteration: 1 },
  { type: 'loop-end', reason: 'all-pass', finalSummary: FINAL.summary },
  { type: 'committed', finalState: FINAL, diff: DIFF },
];

describe('AgentTranscript', () => {
  it('renders one row per tool call with iteration number and tool name', () => {
    render(<AgentTranscript events={events} />);
    expect(screen.getByText(/iter 1/i)).toBeTruthy();
    expect(screen.getByText(/diagnose_failures/)).toBeTruthy();
  });

  it('shows pending state for tool calls without a result yet', () => {
    const partial: AgentEvent[] = [
      { type: 'started', snapshot: SNAP, threshold: 0.7, maxIterations: 5 },
      { type: 'iteration-start', iteration: 1 },
      { type: 'tool-call', iteration: 1, name: 'add_tests', args: { n: 3 } },
    ];
    render(<AgentTranscript events={partial} />);
    expect(screen.getByText(/pending/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/__tests__/AgentTranscript.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement AgentTranscript**

Create `src/components/AgentTranscript.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/__tests__/AgentTranscript.test.tsx`

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentTranscript.tsx src/components/__tests__/AgentTranscript.test.tsx
git commit -m "feat(agent): add AgentTranscript component"
```

---

## Task 19: AgentDiff component

**Files:**
- Create: `src/components/AgentDiff.tsx`
- Test: `src/components/__tests__/AgentDiff.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/AgentDiff.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentDiff from '@/components/AgentDiff';
import type { SnapshotDiff } from '@/lib/agent/types';

const DIFF: SnapshotDiff = {
  testsAdded: [{ id: 'test-21', category: 'adversarial', input: 'new adv' }],
  testsRemoved: [],
  testsChanged: [],
  rubricDimensionsChanged: [
    { id: 'redline', beforeDescriptor: 'vague', afterDescriptor: 'sharp', weightDelta: 0 },
  ],
  overallDelta: 0.18,
  perDimensionDelta: [{ id: 'redline', delta: 0.25 }],
};

describe('AgentDiff', () => {
  it('renders the overall delta', () => {
    render(<AgentDiff diff={DIFF} />);
    expect(screen.getByText(/\+0\.18/)).toBeTruthy();
  });

  it('lists added tests count and rubric changes', () => {
    render(<AgentDiff diff={DIFF} />);
    expect(screen.getByText(/1 test added/i)).toBeTruthy();
    expect(screen.getByText(/redline/)).toBeTruthy();
    expect(screen.getByText(/sharp/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/__tests__/AgentDiff.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement AgentDiff**

Create `src/components/AgentDiff.tsx`:

```tsx
'use client';

import type { SnapshotDiff } from '@/lib/agent/types';

function fmt(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(2)}`;
}

export default function AgentDiff({ diff }: { diff: SnapshotDiff }) {
  const overallClass = diff.overallDelta >= 0 ? 'text-success' : 'text-failure';
  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-base text-fg">Score change</h3>
        <span className={`font-mono text-sm ${overallClass}`}>{fmt(diff.overallDelta)} overall</span>
      </div>

      {diff.perDimensionDelta.length > 0 && (
        <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
          {diff.perDimensionDelta.map((d) => (
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/__tests__/AgentDiff.test.tsx`

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentDiff.tsx src/components/__tests__/AgentDiff.test.tsx
git commit -m "feat(agent): add AgentDiff component"
```

---

## Task 20: AgentPanel component

**Files:**
- Create: `src/components/AgentPanel.tsx`
- Test: `src/components/__tests__/AgentPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/AgentPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentPanel from '@/components/AgentPanel';
import type { ImproveStageState } from '@/lib/pageReducer';
import type { Snapshot, SnapshotDiff, AgentState } from '@/lib/agent/types';

const SNAP: Snapshot = {
  tests: [], rubric: { dimensions: [] }, results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: { d: 0.5 } },
};
const DIFF: SnapshotDiff = {
  testsAdded: [], testsRemoved: [], testsChanged: [], rubricDimensionsChanged: [],
  overallDelta: 0.2, perDimensionDelta: [],
};
const FINAL: AgentState = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [], rubric: { dimensions: [] }, results: [],
  summary: { overall: 0.7, passedCount: 0, perDimension: { d: 0.7 } },
};

describe('AgentPanel', () => {
  it('shows Improve button in idle phase when shouldTrigger is true', () => {
    const onImprove = vi.fn();
    render(
      <AgentPanel
        state={{ phase: 'idle' }}
        triggerable
        onImprove={onImprove}
        onRestore={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /improve with agent/i }));
    expect(onImprove).toHaveBeenCalledOnce();
  });

  it('hides itself when not triggerable and idle', () => {
    const { container } = render(
      <AgentPanel state={{ phase: 'idle' }} triggerable={false} onImprove={() => {}} onRestore={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows transcript while running', () => {
    const state: ImproveStageState = {
      phase: 'running',
      events: [{ type: 'iteration-start', iteration: 1 }],
      snapshot: SNAP,
    };
    render(<AgentPanel state={state} triggerable onImprove={() => {}} onRestore={() => {}} />);
    expect(screen.getByText(/iter|thinking/i)).toBeTruthy();
  });

  it('shows diff and Restore button when committed', () => {
    const onRestore = vi.fn();
    const state: ImproveStageState = {
      phase: 'done-committed',
      events: [],
      snapshot: SNAP,
      finalState: FINAL,
      diff: DIFF,
    };
    render(<AgentPanel state={state} triggerable onImprove={() => {}} onRestore={onRestore} />);
    expect(screen.getByText(/\+0\.20/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /restore previous/i }));
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it('shows rollback banner when rolled-back', () => {
    const state: ImproveStageState = {
      phase: 'done-rolled-back',
      events: [],
      snapshot: SNAP,
      restored: SNAP,
    };
    render(<AgentPanel state={state} triggerable onImprove={() => {}} onRestore={() => {}} />);
    expect(screen.getByText(/regressed/i)).toBeTruthy();
  });

  it('shows error message when in error phase', () => {
    const state: ImproveStageState = { phase: 'error', events: [], snapshot: null, message: 'planner crashed' };
    render(<AgentPanel state={state} triggerable onImprove={() => {}} onRestore={() => {}} />);
    expect(screen.getByText(/planner crashed/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run src/components/__tests__/AgentPanel.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement AgentPanel**

Create `src/components/AgentPanel.tsx`:

```tsx
'use client';

import AgentTranscript from '@/components/AgentTranscript';
import AgentDiff from '@/components/AgentDiff';
import type { ImproveStageState } from '@/lib/pageReducer';

type Props = {
  state: ImproveStageState;
  triggerable: boolean;
  onImprove: () => void;
  onRestore: () => void;
};

export default function AgentPanel({ state, triggerable, onImprove, onRestore }: Props) {
  if (state.phase === 'idle' && !triggerable) return null;

  if (state.phase === 'idle') {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-fg">Below threshold</h2>
        <p className="font-body text-sm text-muted">
          The agent can try to lift the weakest dimensions automatically. It will run up to 5 improvement iterations and roll back if it makes things worse.
        </p>
        <button
          type="button"
          onClick={onImprove}
          className="self-start rounded-md border border-border bg-elevated px-3 py-2 font-mono text-xs text-fg hover:bg-surface"
        >
          Improve with agent
        </button>
      </section>
    );
  }

  if (state.phase === 'running') {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-fg">Agent is improving…</h2>
        <AgentTranscript events={state.events} />
      </section>
    );
  }

  if (state.phase === 'done-committed') {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl text-fg">Agent done</h2>
        <AgentDiff diff={state.diff} />
        <button
          type="button"
          onClick={onRestore}
          className="self-start rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-muted hover:bg-elevated"
        >
          Restore previous
        </button>
      </section>
    );
  }

  if (state.phase === 'done-rolled-back') {
    return (
      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-fg">Rolled back</h2>
        <p className="font-body text-sm text-muted">
          The improvement attempt regressed the overall score. Original tests and rubric were restored automatically.
        </p>
      </section>
    );
  }

  // error
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <h2 className="font-display text-xl text-failure">Agent error</h2>
      <p className="font-mono text-xs text-failure">{state.message}</p>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run src/components/__tests__/AgentPanel.test.tsx`

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentPanel.tsx src/components/__tests__/AgentPanel.test.tsx
git commit -m "feat(agent): add AgentPanel component with all 5 phases"
```

---

## Task 21: Wire AgentPanel into page.tsx with SSE consumer

**Files:**
- Modify: `src/app/page.tsx`

The Scorecard renders after the run completes. The AgentPanel renders directly below it. The page owns a small SSE consumer (`runImproveStage`) modelled on `runRunStage` that POSTs to `/api/improve` and dispatches `IMPROVE_EVENT` per frame.

- [ ] **Step 1: Add the SSE consumer and the improve handler**

Open `src/app/page.tsx`. Add the new import and helper, and a new handler.

Add import at the top alongside the others:

```tsx
import AgentPanel from '@/components/AgentPanel';
import type { AgentEvent } from '@/lib/agent/types';
```

Add this helper just below `runRunStage`:

```tsx
async function runImproveStage(
  url: string,
  body: unknown,
  dispatch: (action: { type: 'IMPROVE_EVENT'; event: AgentEvent }) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (!res.body) throw new Error('Empty response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let errored: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as AgentEvent;
      dispatch({ type: 'IMPROVE_EVENT', event });
      if (event.type === 'error') errored = event.message;
    }
  }
  if (errored) throw new SSEEventError(errored);
}
```

- [ ] **Step 2: Add the improve runner inside `Home`**

Inside the `Home` component, after the existing `runEval` function, add:

```tsx
async function runImprove() {
  if (!parsed || !tests || !rubric) return;
  if (runState.phase !== 'done' || runState.current?.kind !== 'done') return;
  const summary = runState.current.summary;
  const results = runState.current.results;
  dispatch({ type: 'IMPROVE_START' });
  try {
    await runImproveStage(
      '/api/improve',
      { parsed, tests, rubric, results, summary },
      dispatch,
    );
  } catch (err) {
    if (err instanceof SSEEventError) return;
    const message = err instanceof Error ? err.message : 'Unknown error.';
    dispatch({ type: 'IMPROVE_EVENT', event: { type: 'error', message } });
  }
}

function restorePrevious() {
  dispatch({ type: 'IMPROVE_RESET' });
}
```

- [ ] **Step 3: Render AgentPanel below Scorecard**

Replace the existing Scorecard block:

```tsx
{ready &&
  parsed &&
  tests &&
  rubric &&
  runState.phase === 'done' &&
  runState.current?.kind === 'done' && (
    <Scorecard
      results={runState.current.results}
      rubric={rubric}
      spec={state.spec}
      parsed={parsed}
      tests={tests}
    />
  )}
```

with:

```tsx
{ready &&
  parsed &&
  tests &&
  rubric &&
  runState.phase === 'done' &&
  runState.current?.kind === 'done' && (
    <>
      <Scorecard
        results={runState.current.results}
        rubric={rubric}
        spec={state.spec}
        parsed={parsed}
        tests={tests}
      />
      <AgentPanel
        state={state.stages.improve}
        triggerable={(() => {
          const s = runState.current.summary;
          return (
            s.overall < 0.75 ||
            Object.values(s.perDimension).some((v) => v < 0.6)
          );
        })()}
        onImprove={runImprove}
        onRestore={restorePrevious}
      />
    </>
  )}
```

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`

Expected: no errors. If `state.stages.improve` is missing, confirm Task 17 reducer changes are committed.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(agent): wire AgentPanel into page with /api/improve SSE consumer"
```

---

## Task 22: End-to-end smoke test and Done-When checklist

**Files:**
- Run: full vitest suite
- Run: dev server smoke test in browser

This task does not write code. It validates the whole pipeline works end-to-end and gates the branch before merge.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test:run`

Expected: every existing test still passes plus the new agent tests. No skipped suites. No unhandled-promise warnings.

If anything fails, fix the offending task before continuing.

- [ ] **Step 2: Type-check the whole repo**

Run: `pnpm tsc --noEmit`

Expected: zero errors.

- [ ] **Step 3: Boot the dev server**

Run: `pnpm dev`

Expected: server listening on `http://localhost:3000`. No build errors in the terminal.

- [ ] **Step 4: Manual smoke test in the browser**

Walk through this script:

1. Open `http://localhost:3000`.
2. Paste the Medical Coding example spec (or any short feature spec).
3. Wait for parse → tests → rubric to complete.
4. Click "Run eval" and wait for the run to complete.
5. The Scorecard appears.
6. **Below the Scorecard**, confirm one of these is true:
   - The AgentPanel renders the "Below threshold" card with the "Improve with agent" button (because either overall < 0.75 or some dimension < 0.6).
   - The AgentPanel renders nothing (because the run already cleared both thresholds).
7. If the button is shown, click it.
8. The panel switches to "Agent is improving…" and the transcript begins to fill, one row per tool call. Iteration numbers should rise. Tool names should be from the 7-tool set.
9. The agent stops on its own within ~3-5 iterations.
10. The panel renders one of:
    - "Agent done" with an AgentDiff (overall delta, per-dimension deltas, tests added, rubric changes) and a "Restore previous" button.
    - "Rolled back" because the attempt regressed.
11. Click "Restore previous" if shown. The panel returns to the trigger card.

Watch the dev server logs for errors. There should be none.

- [ ] **Step 5: Done-when checklist**

Tick each item before opening the PR. If any is false, do not merge.

- [ ] All vitest tests pass (`pnpm test:run` exits 0).
- [ ] `pnpm tsc --noEmit` exits 0.
- [ ] Dev server boots without errors.
- [ ] Smoke script in Step 4 runs to completion at least once on a real spec.
- [ ] When the run is below threshold the AgentPanel offers the Improve button.
- [ ] The agent loop streams transcript events in real time.
- [ ] The agent stops on its own (no infinite loops, max 5 iterations).
- [ ] On regression the panel shows "Rolled back" and the original tests + rubric are intact.
- [ ] On success the panel shows the diff and the Restore button works.
- [ ] No new console errors during the smoke test.

- [ ] **Step 6: Commit the smoke-test note**

There is no code change for this task. Skip the commit step. Move on to opening the PR using `superpowers:finishing-a-development-branch`.

---
