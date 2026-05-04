import { generateText, stepCountIs } from 'ai';
import {
  newBudget,
  tokensFromUsage,
  chargeBudget,
  tickIteration,
  classifyStop,
  isBudgetExhausted,
  isIterationCapReached,
} from '@/lib/agent/budget';
import { buildOrchestratorRegistry } from '@/lib/agent/orchestratorTools';
import type {
  OrchBudget,
  OrchToolName,
  OrchestratorEvent,
  OrchestratorState,
  OrchIteration,
} from '@/lib/agent/types';

const PLANNER_MODEL = 'google/gemini-2.5-pro';

export type OrchestratorInput = {
  id: string;
  spec: string;
  budget?: Partial<OrchBudget>;
};

function buildPrompt(state: OrchestratorState): string {
  const haveParsed = !!state.parsed;
  const haveTests = !!state.tests;
  const haveRubric = !!state.rubric;
  const haveResults = !!state.results && !!state.summary;
  const summaryLine = state.summary
    ? `overall=${state.summary.overall.toFixed(2)}, dims=${Object.entries(state.summary.perDimension).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' ')}`
    : '(not run yet)';
  const recent = state.history
    .slice(-3)
    .map((h) => `  iter ${h.iteration}: ${h.toolName} (${h.tokensSpentThisIteration} tok)`)
    .join('\n');
  const clarifications = state.clarifications.length
    ? '\nUser clarifications (most recent first):\n' +
      state.clarifications
        .slice()
        .reverse()
        .slice(0, 3)
        .map((c) => `  Q: ${c.question}\n  A: ${c.answer}`)
        .join('\n')
    : '';

  return `You are an evaluation orchestrator. Your job: take a raw feature spec and produce a high-quality eval suite (parsed spec + tests + rubric + judge results) by calling tools one at a time.

Spec (raw):
"""
${state.spec.slice(0, 4000)}
"""
${clarifications}
Pipeline progress:
- parsed: ${haveParsed ? 'YES' : 'no'}
- tests: ${haveTests ? `YES (${state.tests!.length})` : 'no'}
- rubric: ${haveRubric ? `YES (${state.rubric!.dimensions.length} dims)` : 'no'}
- results: ${haveResults ? `YES (${summaryLine})` : 'no'}

Budget:
- iterations: ${state.budget.iterations} / ${state.budget.capIterations}
- tokens: ${state.budget.spentTokens} / ${state.budget.capTokens}
- score target: ${state.budget.capScoreThreshold}

Recent (most recent last):
${recent || '  (none)'}

Strategy:
1. If pipeline is incomplete, build it: parse_spec → generate_tests → generate_rubric → run_eval_now (in that order).
2. Once results exist, if any dimension is below ${state.budget.capScoreThreshold}, use improver tools (diagnose_failures, add_adversarial_tests, tighten_rubric_descriptors, etc.) and rerun with run_eval_now.
3. After every mutation, you MUST call run_eval_now before deciding the next action.
4. If overall score is at or above ${state.budget.capScoreThreshold} on every dimension, call early_stop with a brief reason.
5. Use clarify_with_user ONLY if the spec is genuinely ambiguous in a way that changes which tools you would call. Do not ask cosmetic questions. After at most one clarification, do not ask again unless absolutely necessary.
6. Be frugal — every tool call costs tokens.

Choose ONE tool to call now.`;
}

function applyState(state: OrchestratorState, update: Partial<OrchestratorState>): OrchestratorState {
  return {
    ...state,
    parsed: update.parsed ?? state.parsed,
    tests: update.tests ?? state.tests,
    rubric: update.rubric ?? state.rubric,
    results: update.results ?? state.results,
    summary: update.summary ?? state.summary,
    earlyStopReason: update.earlyStopReason ?? state.earlyStopReason,
    pendingClarify: update.pendingClarify ?? state.pendingClarify,
  };
}

function allDimensionsPass(state: OrchestratorState): boolean {
  if (!state.summary) return false;
  if (state.summary.overall < state.budget.capScoreThreshold) return false;
  return Object.values(state.summary.perDimension).every(
    (v) => v >= state.budget.capScoreThreshold,
  );
}

function freshState(input: OrchestratorInput): OrchestratorState {
  return {
    spec: input.spec,
    history: [],
    clarifications: [],
    budget: newBudget(input.budget),
  };
}

export type OrchestratorOptions = {
  initialState?: OrchestratorState;
  // Called at terminal points (paused / done / error / aborted) with the
  // current state. The route uses this to persist on pause and to delete
  // state on done.
  onCheckpoint?: (state: OrchestratorState, kind: 'paused' | 'done' | 'error' | 'aborted') => Promise<void> | void;
};

// Run from scratch (new orchestration) or from a resumed state.
// `options.initialState` takes precedence over `input` when provided.
export async function* runOrchestrator(
  input: OrchestratorInput,
  signal: AbortSignal,
  options: OrchestratorOptions = {},
): AsyncGenerator<OrchestratorEvent> {
  const { initialState, onCheckpoint } = options;
  const checkpoint = async (kind: 'paused' | 'done' | 'error' | 'aborted') => {
    if (onCheckpoint) await onCheckpoint(state, kind);
  };
  let state: OrchestratorState = initialState
    ? { ...initialState, pendingClarify: undefined }
    : freshState(input);

  yield { type: 'orch-started', id: input.id, budget: state.budget };

  while (true) {
    if (signal.aborted) {
      yield { type: 'orch-aborted' };
      await checkpoint('aborted');
      return;
    }
    if (isIterationCapReached(state.budget)) {
      yield { type: 'orch-done', reason: 'iteration-cap', finalState: state };
      await checkpoint('done');
      return;
    }
    if (isBudgetExhausted(state.budget)) {
      yield { type: 'orch-done', reason: 'budget-cap', finalState: state };
      await checkpoint('done');
      return;
    }
    if (allDimensionsPass(state)) {
      yield { type: 'orch-done', reason: 'all-pass', finalState: state };
      await checkpoint('done');
      return;
    }

    const n = state.budget.iterations + 1;
    yield { type: 'orch-iteration', n };

    const tools = buildOrchestratorRegistry({ state, spec: state.spec, signal });

    type GenResult = {
      steps: { toolCalls?: { toolName: string; input: unknown }[]; toolResults?: { output: unknown }[] }[];
      usage?: unknown;
    };
    let result: GenResult;
    try {
      result = (await generateText({
        model: PLANNER_MODEL,
        tools,
        stopWhen: stepCountIs(1),
        messages: [{ role: 'user', content: buildPrompt(state) }],
        abortSignal: signal,
      })) as unknown as GenResult;
    } catch (err) {
      yield {
        type: 'orch-error',
        message: err instanceof Error ? err.message : String(err),
      };
      await checkpoint('error');
      return;
    }

    const step = result.steps[result.steps.length - 1];
    const call = step?.toolCalls?.[0];
    const res = step?.toolResults?.[0];
    if (!call || !res) {
      yield { type: 'orch-error', message: 'planner returned no tool call' };
      await checkpoint('error');
      return;
    }

    const toolName = call.toolName as OrchToolName;
    const args = call.input;
    const output = res.output as { public: unknown; stateUpdate: Partial<OrchestratorState> };
    const tokensThisIter = tokensFromUsage(result.usage as never);

    yield { type: 'orch-tool-call', n, name: toolName, args };

    state = applyState(state, output.stateUpdate);
    state = {
      ...state,
      budget: tickIteration(chargeBudget(state.budget, tokensThisIter)),
    };
    const iter: OrchIteration = {
      iteration: n,
      toolName,
      args,
      publicResult: output.public,
      tokensSpentThisIteration: tokensThisIter,
    };
    state = { ...state, history: [...state.history, iter] };

    yield { type: 'orch-tool-result', n, name: toolName, public: output.public };
    yield {
      type: 'orch-state',
      parsed: state.parsed,
      tests: state.tests,
      rubric: state.rubric,
      summary: state.summary,
    };
    yield {
      type: 'orch-budget',
      spentTokens: state.budget.spentTokens,
      iterations: state.budget.iterations,
    };

    if (toolName === 'clarify_with_user' && state.pendingClarify) {
      yield {
        type: 'orch-paused',
        id: input.id,
        question: state.pendingClarify.question,
      };
      // Persist state so a resume() request can pick it up.
      await checkpoint('paused');
      return;
    }

    if (toolName === 'early_stop') {
      yield { type: 'orch-done', reason: 'early-stop', finalState: state };
      await checkpoint('done');
      return;
    }

    const stop = classifyStop(state.budget, allDimensionsPass(state), false);
    if (stop) {
      yield { type: 'orch-done', reason: stop, finalState: state };
      await checkpoint('done');
      return;
    }
  }
}

// Helper for tests / route to fold an answer into a paused state.
export function applyClarificationAnswer(
  state: OrchestratorState,
  answer: string,
): OrchestratorState {
  if (!state.pendingClarify) return state;
  const exchange = {
    question: state.pendingClarify.question,
    answer,
    askedAt: state.pendingClarify.askedAt,
    answeredAt: Date.now(),
  };
  return {
    ...state,
    pendingClarify: undefined,
    clarifications: [...state.clarifications, exchange],
  };
}

// Public live state accessor for callers that need to persist mid-stream.
// We expose the fields the route needs without the route reading internals.
export type StateSnapshot = OrchestratorState;
