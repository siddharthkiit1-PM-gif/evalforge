import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

import { generateText } from 'ai';
import { runOrchestrator } from '@/lib/agent/orchestrator';
import type { OrchestratorEvent } from '@/lib/agent/types';

type FakeStep = {
  toolName: string;
  input: unknown;
  publicResult: unknown;
  stateUpdate: Record<string, unknown>;
  tokens: number;
};

function asGenerateTextResult(step: FakeStep) {
  return {
    steps: [
      {
        toolCalls: [{ toolName: step.toolName, input: step.input }],
        toolResults: [
          {
            output: {
              public: step.publicResult,
              stateUpdate: step.stateUpdate,
            },
          },
        ],
      },
    ],
    usage: { totalTokens: step.tokens },
  };
}

async function collect(g: AsyncGenerator<OrchestratorEvent>): Promise<OrchestratorEvent[]> {
  const out: OrchestratorEvent[] = [];
  for await (const e of g) out.push(e);
  return out;
}

const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>;

describe('runOrchestrator', () => {
  beforeEach(() => mockGenerateText.mockReset());

  it('emits orch-started, iteration events, and stops on early_stop', async () => {
    mockGenerateText.mockResolvedValueOnce(
      asGenerateTextResult({
        toolName: 'early_stop',
        input: { reason: 'good enough' },
        publicResult: { stopped: true, reason: 'good enough' },
        stateUpdate: { earlyStopReason: 'good enough' },
        tokens: 100,
      }),
    );

    const events = await collect(
      runOrchestrator({ id: 'test-1', spec: 'a feature' }, new AbortController().signal),
    );

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('orch-started');
    expect(types).toContain('orch-iteration');
    expect(types).toContain('orch-tool-call');
    expect(types).toContain('orch-tool-result');
    expect(types).toContain('orch-budget');
    const last = events[events.length - 1];
    expect(last.type).toBe('orch-done');
    if (last.type === 'orch-done') expect(last.reason).toBe('early-stop');
  });

  it('stops at iteration-cap when planner keeps calling tools without all-pass', async () => {
    mockGenerateText.mockResolvedValue(
      asGenerateTextResult({
        toolName: 'parse_spec',
        input: {},
        publicResult: { feature: 'x', inputs: [], outputs: [], constraints: [], domain: 'general' },
        stateUpdate: {
          parsed: { feature: 'x', inputs: [], outputs: [], constraints: [], domain: 'general' },
        },
        tokens: 50,
      }),
    );

    const events = await collect(
      runOrchestrator(
        { id: 'test-2', spec: 's', budget: { capIterations: 2 } },
        new AbortController().signal,
      ),
    );
    const last = events[events.length - 1];
    expect(last.type).toBe('orch-done');
    if (last.type === 'orch-done') expect(last.reason).toBe('iteration-cap');
  });

  it('stops at budget-cap when token usage exceeds cap', async () => {
    mockGenerateText.mockResolvedValue(
      asGenerateTextResult({
        toolName: 'parse_spec',
        input: {},
        publicResult: {},
        stateUpdate: {
          parsed: { feature: 'x', inputs: [], outputs: [], constraints: [], domain: 'general' },
        },
        tokens: 600,
      }),
    );

    const events = await collect(
      runOrchestrator(
        { id: 'test-3', spec: 's', budget: { capTokens: 500, capIterations: 10 } },
        new AbortController().signal,
      ),
    );
    const last = events[events.length - 1];
    expect(last.type).toBe('orch-done');
    if (last.type === 'orch-done') expect(last.reason).toBe('budget-cap');
  });

  it('emits orch-aborted when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const events = await collect(runOrchestrator({ id: 'test-4', spec: 's' }, ac.signal));
    expect(events.some((e) => e.type === 'orch-aborted')).toBe(true);
  });

  it('emits orch-error when planner returns no tool call', async () => {
    mockGenerateText.mockResolvedValueOnce({ steps: [{ toolCalls: [], toolResults: [] }], usage: { totalTokens: 10 } } as never);
    const events = await collect(
      runOrchestrator({ id: 'test-5', spec: 's' }, new AbortController().signal),
    );
    const err = events.find((e) => e.type === 'orch-error');
    expect(err?.type === 'orch-error' && err.message).toMatch(/no tool call/);
  });
});
