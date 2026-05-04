import { generateText, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import type { AgentState, AgentIteration, ToolName, StateUpdate } from '@/lib/agent/types';
import { buildToolRegistry } from '@/lib/agent/tools';

const PLANNER_MODEL = google('gemini-2.5-pro');

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
