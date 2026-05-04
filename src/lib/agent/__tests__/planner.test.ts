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
