import type { ToolName } from '@/lib/agent/types';

// The canonical set of tool names. Used to typecheck the AI-SDK registry
// and to drive the planner prompt's "Available tools:" section.
export const TOOL_NAMES = [
  'diagnose_failures',
  'add_tests',
  'add_adversarial_tests',
  'revise_rubric',
  'tighten_rubric_descriptors',
  'rewrite_test',
  'rerun_eval',
] as const satisfies readonly ToolName[];

// Tool handlers return BOTH the public-facing result (shown to planner +
// transcript) and a partial state-update for the loop to merge.
export type ToolHandlerResult<TPublic> = {
  public: TPublic;
  stateUpdate: Partial<import('@/lib/agent/types').AgentState>;
};

// Each tool exports a `<name>Tool` AI-SDK descriptor object built with
// `tool({ description, inputSchema, execute })`. The registry is assembled
// once `buildToolRegistry()` is called below by the planner.
export type AgentToolContext = {
  state: import('@/lib/agent/types').AgentState;
  signal?: AbortSignal;
};
