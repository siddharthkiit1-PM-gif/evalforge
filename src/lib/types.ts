// Domains EvalForge is tuned for. 'general' is the fallback when none of the
// three flagship domains is detected.
export type Domain = 'legal' | 'sales' | 'healthcare' | 'general';

// What the parse-spec call extracts from a free-form feature spec.
export type ParsedSpec = {
  feature: string;          // 1-line summary of the feature
  inputs: string[];         // what the AI receives, one bullet per item
  outputs: string[];        // what the AI produces
  constraints: string[];    // requirements the output must satisfy
  domain: Domain;
};

// One generated test case. The eval runner (Plan C) feeds `input` to the
// feature-as-Gemini and judges the response against the rubric.
export type TestCase = {
  id: string;               // 'test-01' .. 'test-20'
  category: 'happy_path' | 'edge_case' | 'adversarial';
  input: string;
  notes?: string;           // optional, why this test exists
};

// One scoring dimension on the rubric.
export type RubricDimension = {
  id: string;               // kebab-case, e.g. 'factual-accuracy'
  label: string;            // human-readable
  description: string;      // 1-2 sentences explaining the dimension
  weight: number;           // 0-1, dimensions sum to 1.0 within ±0.01
};

export type Rubric = {
  dimensions: RubricDimension[];
};

// Reserved for Plan C — kept here so the state machine can reference them.
export type EvalScore = {
  dimensionId: string;
  score: number;            // 0-1
  reasoning: string;
};

export type EvalResult = {
  testId: string;
  output: string;
  scores: EvalScore[];
  passed: boolean;
};

// ──────────────────────────────────────────────────────────────────────────
// Refinement loop (Sub-project 1)
// ──────────────────────────────────────────────────────────────────────────

// Issues are produced by critique calls and consumed by revise calls.
// `field` is a JSON path into the stage's output (e.g. "tests[3].category").
export type Issue = {
  field: string;
  severity: 'minor' | 'major';
  description: string;
  suggestion: string;
};

// Events emitted by `runRefinement` and serialized over SSE.
export type RefinementEvent<T> =
  | { type: 'generated'; pass: 0; output: T }
  | { type: 'critiquing'; pass: 1 | 2 }
  | { type: 'critiqued'; pass: 1 | 2; issues: Issue[] }
  | { type: 'revising'; pass: 1 | 2 }
  | { type: 'revised'; pass: 1 | 2; output: T }
  | { type: 'done'; output: T }
  | { type: 'error'; message: string };

import type { Summary } from '@/lib/scoring';

// ──────────────────────────────────────────────────────────────────────────
// Eval runner (Plan C)
// ──────────────────────────────────────────────────────────────────────────

// Snapshot of the runner's current state — shown to the user in the UI.
// `progress` is emitted while the batch is running; `done` once on completion.
export type RunSnapshot =
  | { kind: 'progress'; completed: number; total: number; partialResults: ReadonlyArray<EvalResult | Error | undefined> }
  | { kind: 'done'; results: EvalResult[]; summary: Summary };

// Events emitted by /api/run-eval over SSE.
export type RunEvent =
  | { type: 'started'; total: number }
  | { type: 'progress'; completed: number; total: number; partialResults: ReadonlyArray<EvalResult | Error | undefined> }
  | { type: 'done'; results: EvalResult[]; summary: Summary }
  | { type: 'error'; message: string };
