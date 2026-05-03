import { generateJSON } from '@/lib/gemini';
import {
  buildParseSpecPrompt,
  buildParseSpecCritiquePrompt,
  buildParseSpecRevisePrompt,
} from '@/lib/prompts';
import { runRefinement } from '@/lib/refinement';
import type { Issue, ParsedSpec, RefinementEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

function frame(event: RefinementEvent<ParsedSpec>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const spec = (body as { spec?: unknown }).spec;
  if (typeof spec !== 'string' || spec.trim().length === 0) {
    return Response.json({ error: 'spec must be a non-empty string.' }, { status: 400 });
  }
  const trimmed = spec.trim();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const generator = runRefinement<ParsedSpec>({
        generate: () => generateJSON<ParsedSpec>(buildParseSpecPrompt(trimmed)),
        critique: async (current) => {
          const result = await generateJSON<{ issues: Issue[] }>(
            buildParseSpecCritiquePrompt(trimmed, current),
          );
          return Array.isArray(result?.issues) ? result.issues : [];
        },
        revise: (current, issues) =>
          generateJSON<ParsedSpec>(buildParseSpecRevisePrompt(current, issues)),
        signal: req.signal,
      });
      try {
        for await (const evt of generator) {
          controller.enqueue(encoder.encode(frame(evt)));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
