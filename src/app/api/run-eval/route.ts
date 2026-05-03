import { generateJSON } from '@/lib/gemini';
import { runBatched } from '@/lib/runBatched';
import { buildRunEvalPrompt } from '@/lib/prompts';
import { summarize, weightedOverall } from '@/lib/scoring';
import type { EvalResult, ParsedSpec, Rubric, TestCase, RunEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

const TICK_MS = 2000;
const PASS_THRESHOLD_DEFAULT = 0.7;

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

type RawJudge = { output?: string; scores?: { dimensionId: string; score: number; reasoning: string }[] };

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

        const judgeOne = async (test: TestCase): Promise<EvalResult> => {
          const raw = await generateJSON<RawJudge>(buildRunEvalPrompt(parsed, rubric, test));
          const scores = raw.scores ?? [];
          const passedScore = weightedOverall(scores, rubric);
          return {
            testId: test.id,
            output: raw.output ?? '',
            scores,
            passed: passedScore >= PASS_THRESHOLD_DEFAULT,
          };
        };

        const partial = await runBatched<TestCase, EvalResult>(tests, judgeOne, {
          concurrency: 2,
          gapMs: 15000,
          signal: req.signal,
          onProgress: (completed, p) => { lastSnapshot = { completed, partialResults: p }; },
        });

        const results: EvalResult[] = partial.map((r, i) =>
          r instanceof Error
            ? { testId: tests[i].id, output: '', scores: [], passed: false }
            : (r as EvalResult)
        );
        const summary = summarize(results, rubric, PASS_THRESHOLD_DEFAULT);

        safeEnqueue({ type: 'done', results, summary });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        safeEnqueue({ type: 'error', message });
      } finally {
        stop();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
