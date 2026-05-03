export type RunBatchedOptions<U> = {
  concurrency: number;
  gapMs: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, partial: ReadonlyArray<U | Error | undefined>) => void;
};

export async function runBatched<T, U>(
  items: T[],
  fn: (item: T, signal?: AbortSignal) => Promise<U>,
  opts: RunBatchedOptions<U>,
): Promise<(U | Error)[]> {
  const { concurrency, gapMs, signal, onProgress } = opts;
  const results: (U | Error)[] = new Array(items.length);
  let next = 0;
  let completed = 0;

  if (signal?.aborted) throw new Error('Aborted');

  // Resolves when the signal aborts. Never rejects, so it can sit in a race
  // without producing an unhandled rejection if it loses.
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<'aborted'>((resolve) => {
    if (!signal) return;
    onAbort = () => resolve('aborted');
    signal.addEventListener('abort', onAbort, { once: true });
  });

  // Wraps an awaitable so we wake up early on abort. Returns a sentinel when
  // aborted; otherwise the original value.
  const ABORTED = Symbol('aborted');
  const raceAbort = async <V>(p: Promise<V>): Promise<V | typeof ABORTED> => {
    const winner = await Promise.race([p.then((v) => ({ v })), abortPromise]);
    if (winner === 'aborted') return ABORTED;
    return (winner as { v: V }).v;
  };

  const worker = async () => {
    let lastStart = -Infinity;
    while (true) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= items.length) return;

      const wait = Math.max(0, gapMs - (Date.now() - lastStart));
      if (wait > 0) {
        const r = await raceAbort(new Promise<void>((res) => setTimeout(res, wait)));
        if (r === ABORTED) return;
      }
      lastStart = Date.now();

      try {
        const r = await raceAbort(fn(items[i], signal));
        if (r === ABORTED) return;
        results[i] = r as U;
      } catch (err) {
        if (signal?.aborted) return;
        results[i] = err instanceof Error ? err : new Error(String(err));
      }
      completed++;
      onProgress?.(completed, results.slice());
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());

  try {
    await Promise.all(workers);
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }

  if (signal?.aborted) throw new Error('Aborted');
  return results;
}
