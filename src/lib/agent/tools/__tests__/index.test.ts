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
