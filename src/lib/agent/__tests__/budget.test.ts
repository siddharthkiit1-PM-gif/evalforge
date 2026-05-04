import { describe, it, expect } from 'vitest';
import {
  newBudget,
  tokensFromUsage,
  chargeBudget,
  tickIteration,
  isBudgetExhausted,
  isIterationCapReached,
  classifyStop,
} from '@/lib/agent/budget';

describe('budget', () => {
  it('newBudget applies defaults and overrides', () => {
    const b = newBudget({ capTokens: 100 });
    expect(b.capTokens).toBe(100);
    expect(b.spentTokens).toBe(0);
    expect(b.iterations).toBe(0);
    expect(b.capIterations).toBeGreaterThan(0);
  });

  it('tokensFromUsage prefers totalTokens then sums prompt+completion then input+output', () => {
    expect(tokensFromUsage({ totalTokens: 50 })).toBe(50);
    expect(tokensFromUsage({ promptTokens: 10, completionTokens: 5 })).toBe(15);
    expect(tokensFromUsage({ inputTokens: 7, outputTokens: 3 })).toBe(10);
    expect(tokensFromUsage(undefined)).toBe(0);
    expect(tokensFromUsage({})).toBe(0);
  });

  it('chargeBudget accumulates spent tokens', () => {
    let b = newBudget({ capTokens: 100 });
    b = chargeBudget(b, 30);
    b = chargeBudget(b, 25);
    expect(b.spentTokens).toBe(55);
  });

  it('tickIteration increments iterations', () => {
    let b = newBudget({ capIterations: 3 });
    b = tickIteration(b);
    expect(b.iterations).toBe(1);
    b = tickIteration(b);
    expect(b.iterations).toBe(2);
  });

  it('isBudgetExhausted is true at and beyond cap', () => {
    const b = newBudget({ capTokens: 100 });
    expect(isBudgetExhausted(b)).toBe(false);
    expect(isBudgetExhausted({ ...b, spentTokens: 99 })).toBe(false);
    expect(isBudgetExhausted({ ...b, spentTokens: 100 })).toBe(true);
    expect(isBudgetExhausted({ ...b, spentTokens: 200 })).toBe(true);
  });

  it('isIterationCapReached is true at and beyond cap', () => {
    const b = newBudget({ capIterations: 3 });
    expect(isIterationCapReached(b)).toBe(false);
    expect(isIterationCapReached({ ...b, iterations: 3 })).toBe(true);
  });

  it('classifyStop priority: early-stop > all-pass > iteration-cap > budget-cap', () => {
    const base = newBudget({ capTokens: 100, capIterations: 3 });
    expect(classifyStop(base, false, false)).toBeNull();
    expect(classifyStop(base, false, true)).toBe('early-stop');
    expect(classifyStop(base, true, false)).toBe('all-pass');
    expect(classifyStop({ ...base, iterations: 3 }, false, false)).toBe('iteration-cap');
    expect(classifyStop({ ...base, spentTokens: 100 }, false, false)).toBe('budget-cap');
    // early-stop wins over all-pass
    expect(classifyStop(base, true, true)).toBe('early-stop');
    // all-pass wins over iteration-cap
    expect(classifyStop({ ...base, iterations: 3 }, true, false)).toBe('all-pass');
  });
});
