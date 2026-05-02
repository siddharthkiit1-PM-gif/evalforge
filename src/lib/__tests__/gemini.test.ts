import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractJSON, withRetry, generateJSON } from '@/lib/gemini';

const generateContentMock = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = { generateContent: generateContentMock };
  }
  return { GoogleGenAI };
});

describe('extractJSON', () => {
  it('parses a plain JSON string', () => {
    expect(extractJSON<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it('strips a ```json code fence', () => {
    const text = '```json\n{"a": 1}\n```';
    expect(extractJSON<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it('strips a generic ``` code fence', () => {
    const text = '```\n{"a": 1}\n```';
    expect(extractJSON<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it('strips leading/trailing whitespace', () => {
    expect(extractJSON<{ a: number }>('  {"a": 1}  ')).toEqual({ a: 1 });
  });

  it('throws on invalid JSON', () => {
    expect(() => extractJSON('not json')).toThrow();
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result when the first call succeeds', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 with exponential backoff', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 10 });
    // First failure → wait 10ms
    await vi.advanceTimersByTimeAsync(10);
    // Second failure → wait 20ms
    await vi.advanceTimersByTimeAsync(20);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting attempts', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(err);

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 10 });
    promise.catch(() => {}); // prevent unhandled rejection
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    await expect(promise).rejects.toThrow('rate limited');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-429 errors', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 10 })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('generateJSON', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    generateContentMock.mockReset();
  });

  it('parses a fenced JSON response into the requested type', async () => {
    generateContentMock.mockResolvedValueOnce({
      text: '```json\n{"name": "ada", "score": 42}\n```',
    });

    type Result = { name: string; score: number };
    const result = await generateJSON<Result>('prompt');

    expect(result).toEqual({ name: 'ada', score: 42 });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      contents: 'prompt',
    });
  });

  it('throws when response.text is missing or not a string', async () => {
    generateContentMock.mockResolvedValueOnce({ text: undefined });
    await expect(generateJSON('prompt')).rejects.toThrow(
      'Gemini response had no text payload.',
    );

    generateContentMock.mockResolvedValueOnce({ text: 123 });
    await expect(generateJSON('prompt')).rejects.toThrow(
      'Gemini response had no text payload.',
    );
  });

  it('propagates non-429 SDK errors without retrying', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('sdk failed'));
    await expect(generateJSON('prompt')).rejects.toThrow('sdk failed');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});
