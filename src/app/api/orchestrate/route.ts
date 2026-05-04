import { runOrchestrator } from '@/lib/agent/orchestrator';
import type { OrchestratorEvent } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

const enc = new TextEncoder();
const frame = (e: OrchestratorEvent) => enc.encode(`data: ${JSON.stringify(e)}\n\n`);

export async function POST(req: Request): Promise<Response> {
  let body: { spec?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (typeof body.spec !== 'string' || body.spec.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'spec must be a non-empty string' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const spec = body.spec;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (e: OrchestratorEvent) => {
        if (closed) return;
        try {
          controller.enqueue(frame(e));
        } catch {
          /* torn down */
        }
      };
      const stop = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      try {
        for await (const evt of runOrchestrator({ spec }, req.signal)) {
          safeEnqueue(evt);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        safeEnqueue({ type: 'orch-error', message });
      } finally {
        stop();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
