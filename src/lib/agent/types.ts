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
