import type { Issue, RefinementEvent } from '@/lib/types';

export type RefinementInputs<T> = {
  generate: () => Promise<T>;
  critique: (output: T) => Promise<Issue[]>;
  revise: (output: T, issues: Issue[]) => Promise<T>;
  signal?: AbortSignal;
  // Max revise rounds. Defaults to 2 per the design spec.
  maxPasses?: 1 | 2 | 3;
};

const MAX_PASSES_DEFAULT = 2;

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

// Bounded generate → critique → revise loop.
// Yields one RefinementEvent per phase boundary so the route handler can
// stream them to the client. The loop exits early when a critique returns
// no major issues; it caps at `maxPasses` revise rounds otherwise.
export async function* runRefinement<T>(
  inputs: RefinementInputs<T>,
): AsyncGenerator<RefinementEvent<T>> {
  const { generate, critique, revise, signal } = inputs;
  const maxPasses = inputs.maxPasses ?? MAX_PASSES_DEFAULT;

  if (isAborted(signal)) {
    yield { type: 'error', message: 'aborted' };
    return;
  }

  let output: T;
  try {
    output = await generate();
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }
  yield { type: 'generated', pass: 0, output };

  for (let pass = 1; pass <= maxPasses; pass++) {
    if (isAborted(signal)) {
      yield { type: 'error', message: 'aborted' };
      return;
    }

    yield { type: 'critiquing', pass: pass as 1 | 2 };

    let issues: Issue[];
    try {
      issues = await critique(output);
    } catch (err) {
      // Critique failure is non-fatal: treat as clean and exit cleanly.
      console.warn('[refinement] critique threw; treating as clean:', err);
      issues = [];
    }
    yield { type: 'critiqued', pass: pass as 1 | 2, issues };

    const major = issues.filter((i) => i.severity === 'major');
    if (major.length === 0) break;

    if (isAborted(signal)) {
      yield { type: 'error', message: 'aborted' };
      return;
    }

    yield { type: 'revising', pass: pass as 1 | 2 };

    try {
      output = await revise(output, major);
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      return;
    }
    yield { type: 'revised', pass: pass as 1 | 2, output };
  }

  yield { type: 'done', output };
}
