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
