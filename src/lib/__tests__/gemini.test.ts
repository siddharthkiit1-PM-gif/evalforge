import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractJSON, withRetry } from '@/lib/gemini';

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
