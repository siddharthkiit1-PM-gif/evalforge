import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runBatched } from '@/lib/runBatched';

describe('runBatched', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns results in input order', async () => {
    const items = [1, 2, 3, 4, 5];
    const fn = vi.fn(async (n: number) => n * 2);
    const promise = runBatched(items, fn, { concurrency: 2, gapMs: 0 });
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it('respects concurrency cap', async () => {
    const inflight: number[] = [];
    let max = 0;
    const fn = async (n: number) => {
      inflight.push(n);
      max = Math.max(max, inflight.length);
      await new Promise((r) => setTimeout(r, 100));
      inflight.splice(inflight.indexOf(n), 1);
      return n;
    };
    const promise = runBatched([1, 2, 3, 4, 5, 6], fn, { concurrency: 2, gapMs: 0 });
    await vi.runAllTimersAsync();
    await promise;
    expect(max).toBe(2);
  });

  it('enforces gapMs between starts within a worker', async () => {
    const starts: number[] = [];
    const fn = async (n: number) => {
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 10));
      return n;
    };
    vi.setSystemTime(0);
    const promise = runBatched([1, 2, 3, 4], fn, { concurrency: 1, gapMs: 1000 });
    await vi.runAllTimersAsync();
    await promise;
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
  });

  it('per-item errors are returned in the array, not thrown', async () => {
    const fn = async (n: number) => {
      if (n === 2) throw new Error('boom');
      return n;
    };
    const promise = runBatched([1, 2, 3], fn, { concurrency: 1, gapMs: 0 });
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out[0]).toBe(1);
    expect(out[1]).toBeInstanceOf(Error);
    expect(out[2]).toBe(3);
  });

  it('calls onProgress after each resolve with a snapshot', async () => {
    const onProgress = vi.fn();
    const fn = async (n: number) => n;
    const promise = runBatched([1, 2, 3], fn, { concurrency: 1, gapMs: 0, onProgress });
    await vi.runAllTimersAsync();
    await promise;
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls[2][0]).toBe(3);
    expect(onProgress.mock.calls[2][1]).toEqual([1, 2, 3]);
  });

  it('AbortSignal aborts the batch', async () => {
    const ctrl = new AbortController();
    const fn = async (n: number) => {
      await new Promise((r) => setTimeout(r, 100));
      return n;
    };
    const promise = runBatched([1, 2, 3, 4], fn, { concurrency: 1, gapMs: 0, signal: ctrl.signal });
    // Attach the rejection handler eagerly so the rejection is observed before
    // the fake-timer drain advances time past the abort.
    const assertion = expect(promise).rejects.toThrow(/abort/i);
    setTimeout(() => ctrl.abort(), 50);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('onProgress snapshot includes the full array at concurrency > 1, with holes', async () => {
    const onProgress = vi.fn();
    const fn = async (n: number) => {
      if (n === 0) await new Promise((r) => setTimeout(r, 50));
      return n;
    };
    const promise = runBatched([0, 1], fn, { concurrency: 2, gapMs: 0, onProgress });
    await vi.runAllTimersAsync();
    await promise;
    expect(onProgress.mock.calls[0][0]).toBe(1);
    expect(onProgress.mock.calls[0][1]).toEqual([undefined, 1]);
  });

  it('does not record or report when fn throws because signal aborted', async () => {
    const ctrl = new AbortController();
    const onProgress = vi.fn();
    const fn = async (_: number, sig?: AbortSignal) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 100);
        sig?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('AbortError'));
        });
      });
      return 0;
    };
    const promise = runBatched([1, 2], fn, { concurrency: 1, gapMs: 0, signal: ctrl.signal, onProgress });
    const assertion = expect(promise).rejects.toThrow(/abort/i);
    setTimeout(() => ctrl.abort(), 20);
    await vi.runAllTimersAsync();
    await assertion;
    expect(onProgress).not.toHaveBeenCalled();
  });
});
