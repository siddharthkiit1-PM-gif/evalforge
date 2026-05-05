import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrchestratorPanel from '@/components/OrchestratorPanel';
import type { OrchestrateStageState } from '@/lib/pageReducer';
import type { OrchestratorEvent, OrchestratorState } from '@/lib/agent/types';
import type { EvalResult, ParsedSpec, Rubric, TestCase } from '@/lib/types';

const PARSED: ParsedSpec = {
  feature: 'support triage',
  inputs: [],
  outputs: [],
  constraints: [],
  domain: 'general',
};

const TESTS: TestCase[] = [
  { id: 't1', category: 'happy_path', input: 'angry customer', notes: '' },
  { id: 't2', category: 'adversarial', input: 'spam pitch', notes: '' },
];

const RUBRIC: Rubric = {
  dimensions: [
    { id: 'category', label: 'Category accuracy', description: 'Picks the right bucket.', weight: 1 },
  ],
};

const RESULTS: EvalResult[] = [
  {
    testId: 't1',
    output: 'ok',
    passed: true,
    scores: [{ dimensionId: 'category', score: 0.9, reasoning: '' }],
  },
];

function runningState(latest: Partial<OrchestratorState>): OrchestrateStageState {
  const events: OrchestratorEvent[] = [
    { type: 'orch-started', id: 'orch-1', budget: { capTokens: 250000, capIterations: 12, capScoreThreshold: 0.8, spentTokens: 0, iterations: 0 } },
  ];
  return { phase: 'running', id: 'orch-1', events, latest };
}

function doneState(finalState: OrchestratorState): OrchestrateStageState {
  return {
    phase: 'done',
    events: [
      { type: 'orch-started', id: 'orch-1', budget: finalState.budget },
      { type: 'orch-done', reason: 'all-pass', finalState },
    ],
    reason: 'all-pass',
    finalState,
  };
}

describe('OrchestratorPanel artifacts', () => {
  it('renders parsed/tests/rubric while streaming when latest carries them', () => {
    const state = runningState({ parsed: PARSED, tests: TESTS, rubric: RUBRIC });
    render(<OrchestratorPanel state={state} spec="raw spec" onReset={() => {}} onResume={() => {}} />);
    expect(screen.getByText(/Parsed spec/i)).toBeInTheDocument();
    expect(screen.getByText(/Test suite \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText('Category accuracy')).toBeInTheDocument();
    // No Scorecard while streaming (no results yet).
    expect(screen.queryByText(/^Results$/)).not.toBeInTheDocument();
  });

  it('renders Scorecard when done with results', () => {
    const finalState: OrchestratorState = {
      spec: 'raw spec',
      history: [],
      clarifications: [],
      budget: { capTokens: 250000, capIterations: 12, capScoreThreshold: 0.8, spentTokens: 1000, iterations: 4 },
      parsed: PARSED,
      tests: TESTS,
      rubric: RUBRIC,
      results: RESULTS,
      summary: { overall: 0.9, perDimension: { category: 0.9 }, passedCount: 1 },
    };
    render(<OrchestratorPanel state={doneState(finalState)} spec="raw spec" onReset={() => {}} onResume={() => {}} />);
    expect(screen.getByText(/^Results$/)).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('hides inline summary block when Scorecard is showing', () => {
    const finalState: OrchestratorState = {
      spec: 'raw spec',
      history: [],
      clarifications: [],
      budget: { capTokens: 250000, capIterations: 12, capScoreThreshold: 0.8, spentTokens: 1000, iterations: 4 },
      parsed: PARSED,
      tests: TESTS,
      rubric: RUBRIC,
      results: RESULTS,
      summary: { overall: 0.9, perDimension: { category: 0.9 }, passedCount: 1 },
    };
    render(<OrchestratorPanel state={doneState(finalState)} spec="raw spec" onReset={() => {}} onResume={() => {}} />);
    // The compact mono "overall" label only exists in the inline summary block.
    expect(screen.queryByText(/^overall$/)).not.toBeInTheDocument();
  });
});
