import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/api/orchestrate/resume/route';
import { saveState, deleteState, __resetBackend } from '@/lib/orchState/store';
import type { OrchestratorState } from '@/lib/agent/types';

// Stub the orchestrator so the route doesn't try to call the model.
vi.mock('@/lib/agent/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent/orchestrator')>(
    '@/lib/agent/orchestrator',
  );
  return {
    ...actual,
    runOrchestrator: vi.fn(async function* () {
      yield { type: 'orch-done', reason: 'early-stop', finalState: {} } as never;
    }),
  };
});

function pausedState(spec = 'a feature'): OrchestratorState {
  return {
    spec,
    history: [],
    clarifications: [],
    budget: {
      capTokens: 250_000,
      capIterations: 12,
      capScoreThreshold: 0.8,
      spentTokens: 0,
      iterations: 0,
    },
    pendingClarify: { question: 'which domain?', askedAt: 100 },
  };
}

function makeRequest(body: unknown): Request {
  return new Request('http://test/api/orchestrate/resume', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/orchestrate/resume validation', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __resetBackend();
  });

  it('400 on invalid JSON', async () => {
    const res = await POST(makeRequest('not-json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid json' });
  });

  it('400 when id is missing or empty', async () => {
    const res = await POST(makeRequest({ answer: 'medical' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/id required/);
  });

  it('400 when answer is missing or whitespace', async () => {
    const res = await POST(makeRequest({ id: 'x', answer: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/answer required/);
  });

  it('410 when the session id is unknown', async () => {
    const res = await POST(makeRequest({ id: 'missing', answer: 'a' }));
    expect(res.status).toBe(410);
  });

  it('409 when the saved session is not awaiting clarification', async () => {
    const state = pausedState();
    state.pendingClarify = undefined;
    await saveState('not-paused', state);
    const res = await POST(makeRequest({ id: 'not-paused', answer: 'a' }));
    expect(res.status).toBe(409);
    await deleteState('not-paused');
  });

  it('200 SSE when valid: reads saved state and streams resume', async () => {
    await saveState('valid', pausedState());
    const res = await POST(makeRequest({ id: 'valid', answer: 'medical' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    // Drain the stream so no async leaks.
    if (res.body) {
      const reader = res.body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }
    await deleteState('valid');
  });
});
