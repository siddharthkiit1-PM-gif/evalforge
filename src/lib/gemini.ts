import { GoogleGenAI } from '@google/genai';

export const MODEL_ID = 'gemini-2.5-flash-lite';

let cachedClient: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Add it to .env.local.');
  }
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

export function extractJSON<T>(text: string): T {
  let cleaned = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const match = cleaned.match(fence);
  if (match) cleaned = match[1].trim();
  return JSON.parse(cleaned) as T;
}

type RetryOpts = { attempts?: number; baseDelayMs?: number };

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 10_000; // 10s
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 429) throw err;
      if (i === attempts - 1) break;
      const delay = baseDelayMs * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

export async function generateJSON<T>(prompt: string): Promise<T> {
  return withRetry(async () => {
    const response = await client().models.generateContent({
      model: MODEL_ID,
      contents: prompt,
    });
    const text = (response as { text?: unknown }).text;
    if (typeof text !== 'string') {
      throw new Error('Gemini response had no text payload.');
    }
    return extractJSON<T>(text);
  });
}
