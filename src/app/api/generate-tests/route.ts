import { generateJSON } from '@/lib/gemini';
import {
  buildGenerateTestsPrompt,
  buildGenerateTestsCritiquePrompt,
  buildGenerateTestsRevisePrompt,
} from '@/lib/prompts';
import { runRefinement } from '@/lib/refinement';
import type {
  Issue,
  ParsedSpec,
  RefinementEvent,
  TestCase,
} from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
} as const;

function frame(event: RefinementEvent<TestCase[]>): string {
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
      const generator = runRefinement<TestCase[]>({
        generate: async () => {
          const result = await generateJSON<TestCase[] | { tests: TestCase[] }>(
            buildGenerateTestsPrompt(parsed),
          );
          // The existing prompt instructs the model to return an array.
          // Tolerate { tests: [...] } for backward compatibility.
          return Array.isArray(result) ? result : result.tests;
        },
        critique: async (current) => {
          const result = await generateJSON<{ issues: Issue[] }>(
            buildGenerateTestsCritiquePrompt(parsed, current),
          );
          return Array.isArray(result?.issues) ? result.issues : [];
        },
        revise: async (current, issues) => {
          const result = await generateJSON<TestCase[] | { tests: TestCase[] }>(
            buildGenerateTestsRevisePrompt(current, issues),
          );
          return Array.isArray(result) ? result : result.tests;
        },
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
