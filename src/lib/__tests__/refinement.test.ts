import { describe, it, expect, vi } from 'vitest';
import { runRefinement } from '@/lib/refinement';
import type { Issue, RefinementEvent } from '@/lib/types';

async function collect<T>(gen: AsyncGenerator<RefinementEvent<T>>): Promise<RefinementEvent<T>[]> {
  const out: RefinementEvent<T>[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const noIssues: Issue[] = [];
const majorIssue: Issue = {
  field: 'feature',
  severity: 'major',
  description: 'fix me',
  suggestion: 'fix it',
};

describe('runRefinement', () => {
  it('exits after first critique when no major issues', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockResolvedValue(noIssues);
    const revise = vi.fn();
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'done',
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(critique).toHaveBeenCalledTimes(1);
    expect(revise).not.toHaveBeenCalled();
  });

  it('runs one revise round when first critique flags major issues, then exits clean', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi
      .fn()
      .mockResolvedValueOnce([majorIssue])
      .mockResolvedValueOnce(noIssues);
    const revise = vi.fn().mockResolvedValue({ v: 1 });
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'revising',
      'revised',
      'critiquing',
      'critiqued',
      'done',
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(critique).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(1);
  });

  it('caps at N=2 even when issues persist; emits done with the last revised output', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockResolvedValue([majorIssue]);
    const revise = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });
    const events = await collect(runRefinement({ generate, critique, revise }));
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'revising',
      'revised',
      'critiquing',
      'critiqued',
      'revising',
      'revised',
      'done',
    ]);
    const final = events.find((e) => e.type === 'done')!;
    expect((final as { output: { v: number } }).output).toEqual({ v: 2 });
    expect(critique).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(2);
  });

  it('treats minor-only issues as clean and exits', async () => {
    const minor: Issue = { ...majorIssue, severity: 'minor' };
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockResolvedValue([minor]);
    const revise = vi.fn();
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual(['generated', 'critiquing', 'critiqued', 'done']);
    expect(revise).not.toHaveBeenCalled();
  });

  it('emits an error event and stops if generate throws', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('boom'));
    const critique = vi.fn();
    const revise = vi.fn();
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events).toEqual([{ type: 'error', message: 'boom' }]);
    expect(critique).not.toHaveBeenCalled();
  });

  it('emits an error event and stops if revise throws', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockResolvedValue([majorIssue]);
    const revise = vi.fn().mockRejectedValue(new Error('revise failed'));
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'revising',
      'error',
    ]);
  });

  it('treats critique that throws as clean (logs warn, exits loop with current output)', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn().mockRejectedValue(new Error('parse failed'));
    const revise = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = await collect(runRefinement({ generate, critique, revise }));
    expect(events.map((e) => e.type)).toEqual(['generated', 'critiquing', 'critiqued', 'done']);
    const last = events.at(-1) as { type: 'done'; output: { v: number } };
    expect(last.output).toEqual({ v: 0 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('aborts cleanly when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi.fn();
    const revise = vi.fn();
    const events = await collect(
      runRefinement({ generate, critique, revise, signal: controller.signal }),
    );
    expect(events).toEqual([{ type: 'error', message: 'aborted' }]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('preserves the pass counter on critiqued and revised events', async () => {
    const generate = vi.fn().mockResolvedValue({ v: 0 });
    const critique = vi
      .fn()
      .mockResolvedValueOnce([majorIssue])
      .mockResolvedValueOnce([majorIssue])
      .mockResolvedValueOnce(noIssues);
    const revise = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });
    const events = await collect(runRefinement({ generate, critique, revise }));
    const passes = events
      .filter((e) => 'pass' in e)
      .map((e) => (e as { pass: number }).pass);
    // generated:0 critiquing:1 critiqued:1 revising:1 revised:1 critiquing:2 critiqued:2 ...
    expect(passes.slice(0, 7)).toEqual([0, 1, 1, 1, 1, 2, 2]);
  });
});
