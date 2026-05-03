import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, Rubric, TestCase, RunEvent } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

const parsed: ParsedSpec = { feature: 'f', domain: 'general', inputs: [], outputs: [], constraints: [] };
const rubric: Rubric = { dimensions: [{ id: 'a', label: 'A', description: '', weight: 1 }] };
const tests: TestCase[] = [
  { id: 't1', category: 'happy_path', input: 'i1' },
  { id: 't2', category: 'happy_path', input: 'i2' },
];

beforeEach(() => vi.clearAllMocks());

describe('/api/run-eval', () => {
  it('rejects non-JSON body with 400', async () => {
    const { POST } = await import('@/app/api/run-eval/route');
    const res = await POST(new Request('http://x', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed body shape with 400', async () => {
    const { POST } = await import('@/app/api/run-eval/route');
    const res = await POST(new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parsed: {}, rubric: {}, tests: 'nope' }),
    }));
    expect(res.status).toBe(400);
  });

  it('streams started → done with summary on success', async () => {
    const { generateJSON } = await import('@/lib/gemini');
    (generateJSON as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ output: 'o1', scores: [{ dimensionId: 'a', score: 1, reasoning: 'r' }] })
      .mockResolvedValueOnce({ output: 'o2', scores: [{ dimensionId: 'a', score: 0, reasoning: 'r' }] });

    const { POST } = await import('@/app/api/run-eval/route');
    const res = await POST(new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parsed, rubric, tests }),
    }));
    const events = await readSSEStream<RunEvent>(res);
    expect(events[0]).toEqual({ type: 'started', total: 2 });
    const last = events[events.length - 1];
    expect(last.type).toBe('done');
    if (last.type === 'done') {
      expect(last.results).toHaveLength(2);
      expect(last.summary.overall).toBeCloseTo(0.5, 5);
      expect(last.summary.passedCount).toBe(1);
    }
  });

  it('per-item Gemini errors become failed results, batch still completes', async () => {
    const { generateJSON } = await import('@/lib/gemini');
    (generateJSON as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('rate limit'))
      .mockResolvedValueOnce({ output: 'o2', scores: [{ dimensionId: 'a', score: 1, reasoning: 'r' }] });

    const { POST } = await import('@/app/api/run-eval/route');
    const res = await POST(new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parsed, rubric, tests }),
    }));
    const events = await readSSEStream<RunEvent>(res);
    const last = events[events.length - 1];
    expect(last.type).toBe('done');
    if (last.type === 'done') {
      expect(last.results).toHaveLength(2);
      // Failed test gets a result with empty output and 0 score (route's sanitization)
      const failed = last.results.find((r) => r.testId === 't1');
      expect(failed?.scores).toEqual([]);
      expect(failed?.passed).toBe(false);
    }
  });

  it('emits error frame when an unexpected error escapes the batch', async () => {
    // We patch summarize to throw, since per-item errors are caught by runBatched
    vi.doMock('@/lib/scoring', async () => {
      const actual = await vi.importActual<typeof import('@/lib/scoring')>('@/lib/scoring');
      return { ...actual, summarize: () => { throw new Error('summarize crashed'); } };
    });
    vi.resetModules();
    const { POST: POST2 } = await import('@/app/api/run-eval/route');
    const { generateJSON } = await import('@/lib/gemini');
    (generateJSON as ReturnType<typeof vi.fn>).mockResolvedValue({ output: 'o', scores: [{ dimensionId: 'a', score: 1, reasoning: 'r' }] });
    const res = await POST2(new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parsed, rubric, tests }),
    }));
    const events = await readSSEStream<RunEvent>(res);
    const last = events[events.length - 1];
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.message).toMatch(/summarize crashed/);
    vi.doUnmock('@/lib/scoring');
  });
});
