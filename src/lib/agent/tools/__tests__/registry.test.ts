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
