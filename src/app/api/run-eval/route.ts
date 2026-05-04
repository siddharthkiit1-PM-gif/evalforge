import { runEval } from '@/lib/runEval';
import type { EvalResult, ParsedSpec, Rubric, TestCase, RunEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

const TICK_MS = 2000;

const enc = new TextEncoder();
const frame = (e: RunEvent) => enc.encode(`data: ${JSON.stringify(e)}\n\n`);

function isParsed(x: unknown): x is ParsedSpec {
  return !!x && typeof x === 'object'
    && 'feature' in x && typeof (x as { feature: unknown }).feature === 'string'
    && 'domain' in x;
}
function isRubric(x: unknown): x is Rubric {
  return !!x && typeof x === 'object'
    && Array.isArray((x as { dimensions?: unknown }).dimensions);
}
function isTests(x: unknown): x is TestCase[] {
  return Array.isArray(x)
    && x.every((t) => t && typeof t === 'object' && 'id' in t && 'input' in t);
}

export async function POST(req: Request): Promise<Response> {
  let body: { parsed?: unknown; rubric?: unknown; tests?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!isParsed(body.parsed) || !isRubric(body.rubric) || !isTests(body.tests)) {
    return new Response(JSON.stringify({ error: 'invalid body shape' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const parsed = body.parsed as ParsedSpec;
  const rubric = body.rubric as Rubric;
  const tests = body.tests as TestCase[];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let ticker: ReturnType<typeof setInterval> | null = null;
      let lastSnapshot: { completed: number; partialResults: ReadonlyArray<EvalResult | Error | undefined> } = {
        completed: 0,
        partialResults: [],
      };
      let closed = false;

      const safeEnqueue = (e: RunEvent) => {
        if (closed) return;
        try { controller.enqueue(frame(e)); } catch { /* stream already torn down */ }
      };
      const stop = () => {
        if (ticker) { clearInterval(ticker); ticker = null; }
        if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } }
      };

      try {
        safeEnqueue({ type: 'started', total: tests.length });

        ticker = setInterval(() => {
          safeEnqueue({
            type: 'progress',
            completed: lastSnapshot.completed,
            total: tests.length,
            partialResults: lastSnapshot.partialResults,
          });
        }, TICK_MS);

        console.log(`[run-eval] starting batch: ${tests.length} tests, concurrency=2, gapMs=4000`);
        const { results, summary } = await runEval(parsed, rubric, tests, {
          signal: req.signal,
          onProgress: (completed, p) => {
            lastSnapshot = { completed, partialResults: p };
          },
        });
        console.log(`[run-eval] batch resolved: ${results.length} results, ${results.filter((r) => r.scores.length === 0).length} errors`);
        console.log(`[run-eval] emitting done: overall=${summary.overall.toFixed(3)}, passed=${summary.passedCount}/${results.length}`);

        safeEnqueue({ type: 'done', results, summary });
      } catch (err) {
        console.error('[run-eval] outer error:', err instanceof Error ? err.message : err);
        const message = err instanceof Error ? err.message : 'unknown error';
        safeEnqueue({ type: 'error', message });
      } finally {
        stop();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
