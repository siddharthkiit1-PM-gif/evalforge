import { generateJSON } from '@/lib/gemini';
import {
  buildGenerateRubricPrompt,
  buildGenerateRubricCritiquePrompt,
  buildGenerateRubricRevisePrompt,
} from '@/lib/prompts';
import { runRefinement } from '@/lib/refinement';
import type {
  Issue,
  ParsedSpec,
  RefinementEvent,
  Rubric,
} from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

function frame(event: RefinementEvent<Rubric>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function isParsedSpec(v: unknown): v is ParsedSpec {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<ParsedSpec>;
  return (
    typeof p.feature === 'string' &&
    Array.isArray(p.inputs) &&
    Array.isArray(p.outputs) &&
    Array.isArray(p.constraints) &&
    typeof p.domain === 'string'
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = (body as { parsed?: unknown }).parsed;
  if (!isParsedSpec(parsed)) {
    return Response.json(
      { error: 'parsed must be a ParsedSpec object.' },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const generator = runRefinement<Rubric>({
        generate: () => generateJSON<Rubric>(buildGenerateRubricPrompt(parsed)),
        critique: async (current) => {
          const result = await generateJSON<{ issues: Issue[] }>(
            buildGenerateRubricCritiquePrompt(parsed, current),
          );
          return Array.isArray(result?.issues) ? result.issues : [];
        },
        revise: (current, issues) =>
          generateJSON<Rubric>(buildGenerateRubricRevisePrompt(current, issues)),
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
