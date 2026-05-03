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

  it('emits at least one progress frame from the 2 s ticker while a judge is in flight', async () => {
    // Real timers (fake timers fight with Node's async streaming + microtask
    // scheduling inside ReadableStream in Vitest, leading to flaky reads).
    // We hold BOTH judge calls (route runs at concurrency 2) so `completed`
    // stays at 0 long enough for the 2 s ticker to fire at least once, then
    // release to drain.
    const { generateJSON } = await import('@/lib/gemini');
    type Judge = { output: string; scores: { dimensionId: string; score: number; reasoning: string }[] };
    const releases: Array<(v: Judge) => void> = [];
    const makeHeld = () => new Promise<Judge>((resolve) => { releases.push(resolve); });
    (generateJSON as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeHeld())
      .mockReturnValueOnce(makeHeld());

    const { POST } = await import('@/app/api/run-eval/route');
    const res = await POST(new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parsed, rubric, tests }),
    }));
    if (!res.body) throw new Error('no body');

    // Drain the stream in the background so the ticker frames are consumed
    // promptly and the controller doesn't fill its queue.
    const collected: RunEvent[] = [];
    const drainPromise = (async () => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frameStr = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frameStr.split('\n').find((l) => l.startsWith('data: '));
          if (line) collected.push(JSON.parse(line.slice(6)) as RunEvent);
        }
      }
    })();

    // Wait past one ticker tick (2 s) while both judges are still pending.
    await new Promise((r) => setTimeout(r, 2500));

    const midProgress = collected.filter((e) => e.type === 'progress');
    expect(midProgress.length).toBeGreaterThanOrEqual(1);
    const firstProgress = midProgress[0];
    if (firstProgress.type === 'progress') {
      expect(firstProgress.completed).toBe(0);
      expect(firstProgress.total).toBe(tests.length);
    }

    // Release both judges and let the stream finish.
    for (const release of releases) {
      release({ output: 'o', scores: [{ dimensionId: 'a', score: 1, reasoning: 'r' }] });
    }
    await drainPromise;

    const last = collected[collected.length - 1];
    expect(last.type).toBe('done');
  }, 10000);

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
