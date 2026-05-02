import { generateJSON } from '@/lib/gemini';
import { buildParseSpecPrompt } from '@/lib/prompts';
import type { ParsedSpec } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

  try {
    const parsed = await generateJSON<ParsedSpec>(buildParseSpecPrompt(spec.trim()));
    return Response.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return Response.json({ error: message }, { status: 500 });
  }
}
