import { generateJSON } from '@/lib/gemini';
import { buildGenerateTestsPrompt } from '@/lib/prompts';
import type { ParsedSpec, TestCase } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

function isParsedSpec(value: unknown): value is ParsedSpec {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.feature === 'string' &&
    Array.isArray(v.inputs) &&
    Array.isArray(v.outputs) &&
    Array.isArray(v.constraints) &&
    typeof v.domain === 'string'
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
    return Response.json({ error: 'parsed must be a ParsedSpec object.' }, { status: 400 });
  }

  try {
    const tests = await generateJSON<TestCase[]>(buildGenerateTestsPrompt(parsed));
    if (!Array.isArray(tests) || tests.length === 0) {
      return Response.json(
        { error: 'Gemini returned no tests.' },
        { status: 500 },
      );
    }
    return Response.json({ tests });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return Response.json({ error: message }, { status: 500 });
  }
}
