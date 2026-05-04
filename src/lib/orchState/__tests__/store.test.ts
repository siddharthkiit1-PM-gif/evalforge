import { describe, it, expect, beforeEach } from 'vitest';
import { saveState, loadState, deleteState, __resetBackend } from '@/lib/orchState/store';
import type { OrchestratorState } from '@/lib/agent/types';

function makeState(overrides: Partial<OrchestratorState> = {}): OrchestratorState {
  return {
    spec: 'a feature',
    history: [],
    clarifications: [],
    budget: {
      capTokens: 250_000,
      capIterations: 12,
      capScoreThreshold: 0.8,
      spentTokens: 0,
      iterations: 0,
    },
    ...overrides,
  };
}

describe('orchState/store (memory backend)', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __resetBackend();
  });

  it('returns null for an unknown id', async () => {
    expect(await loadState('nope')).toBeNull();
  });

  it('saves and loads round-trip preserves state', async () => {
    const state = makeState({
      pendingClarify: { question: 'what domain?', askedAt: 1000 },
    });
    await saveState('id-1', state);
    const got = await loadState('id-1');
    expect(got).toEqual(state);
  });

  it('deleteState removes the entry', async () => {
    await saveState('id-2', makeState());
    expect(await loadState('id-2')).not.toBeNull();
    await deleteState('id-2');
    expect(await loadState('id-2')).toBeNull();
  });

  it('different ids are isolated', async () => {
    await saveState('a', makeState({ spec: 'A spec' }));
    await saveState('b', makeState({ spec: 'B spec' }));
    expect((await loadState('a'))?.spec).toBe('A spec');
    expect((await loadState('b'))?.spec).toBe('B spec');
  });

  it('overwrite via saveState replaces prior value', async () => {
    await saveState('id-3', makeState({ spec: 'old' }));
    await saveState('id-3', makeState({ spec: 'new' }));
    expect((await loadState('id-3'))?.spec).toBe('new');
  });
});
