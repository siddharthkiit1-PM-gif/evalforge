import type { OrchBudget, OrchStopReason } from '@/lib/agent/types';

export const DEFAULT_BUDGET: Omit<OrchBudget, 'spentTokens' | 'iterations'> = {
  capTokens: 250_000,
  capIterations: 12,
  capScoreThreshold: 0.8,
};

export function newBudget(overrides: Partial<OrchBudget> = {}): OrchBudget {
  return {
    ...DEFAULT_BUDGET,
    spentTokens: 0,
    iterations: 0,
    ...overrides,
  };
}

// AI SDK usage shape. Different providers expose slightly different field
// names; we accept whichever is present.
export type Usage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
};

export function tokensFromUsage(u: Usage | undefined): number {
  if (!u) return 0;
  if (typeof u.totalTokens === 'number') return u.totalTokens;
  const p = u.promptTokens ?? u.inputTokens ?? 0;
  const c = u.completionTokens ?? u.outputTokens ?? 0;
  return p + c;
}

export function chargeBudget(budget: OrchBudget, tokens: number): OrchBudget {
  return { ...budget, spentTokens: budget.spentTokens + tokens };
}

export function tickIteration(budget: OrchBudget): OrchBudget {
  return { ...budget, iterations: budget.iterations + 1 };
}

export function isBudgetExhausted(budget: OrchBudget): boolean {
  return budget.spentTokens >= budget.capTokens;
}

export function isIterationCapReached(budget: OrchBudget): boolean {
  return budget.iterations >= budget.capIterations;
}

export function classifyStop(
  budget: OrchBudget,
  allPass: boolean,
  earlyStop: boolean,
): OrchStopReason | null {
  if (earlyStop) return 'early-stop';
  if (allPass) return 'all-pass';
  if (isIterationCapReached(budget)) return 'iteration-cap';
  if (isBudgetExhausted(budget)) return 'budget-cap';
  return null;
}
