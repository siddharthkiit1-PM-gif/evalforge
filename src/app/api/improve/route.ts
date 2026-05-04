import { runAgentLoop } from '@/lib/agent/loop';
import type { AgentEvent } from '@/lib/agent/types';
import type { EvalResult, ParsedSpec, Rubric, TestCase } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

const enc = new TextEncoder();
const frame = (e: AgentEvent) => enc.encode(`data: ${JSON.stringify(e)}\n\n`);

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
function isResults(x: unknown): x is EvalResult[] {
  return Array.isArray(x)
    && x.every((r) => r && typeof r === 'object' && 'testId' in r && 'scores' in r);
}
function isSummary(x: unknown): x is Summary {
  return !!x && typeof x === 'object'
    && typeof (x as { overall?: unknown }).overall === 'number'
    && typeof (x as { perDimension?: unknown }).perDimension === 'object';
}

export async function POST(req: Request): Promise<Response> {
  let body: {
    parsed?: unknown;
    rubric?: unknown;
    tests?: unknown;
    results?: unknown;
    summary?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (
    !isParsed(body.parsed)
    || !isRubric(body.rubric)
    || !isTests(body.tests)
    || !isResults(body.results)
    || !isSummary(body.summary)
  ) {
    return new Response(JSON.stringify({ error: 'invalid body shape' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (e: AgentEvent) => {
        if (closed) return;
        try { controller.enqueue(frame(e)); } catch { /* torn down */ }
      };
      try {
        for await (const event of runAgentLoop(
          {
            parsed: body.parsed as ParsedSpec,
            tests: body.tests as TestCase[],
            rubric: body.rubric as Rubric,
            results: body.results as EvalResult[],
            summary: body.summary as Summary,
            threshold: 0.7,
            maxIterations: 5,
          },
          req.signal,
        )) {
          safeEnqueue(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        safeEnqueue({ type: 'error', message });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
