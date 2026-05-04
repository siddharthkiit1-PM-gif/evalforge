import { generateJSON } from '@/lib/gemini';
import { runBatched } from '@/lib/runBatched';
import { buildRunEvalPrompt } from '@/lib/prompts';
import { summarize, weightedOverall } from '@/lib/scoring';
import type { Summary } from '@/lib/scoring';
import type { EvalResult, ParsedSpec, Rubric, TestCase } from '@/lib/types';

const PASS_THRESHOLD_DEFAULT = 0.7;

type RawJudge = {
  output?: unknown;
  scores?: { dimensionId: string; score: number; reasoning: string }[];
};

type RunEvalOptions = {
  signal?: AbortSignal;
  onProgress?: (completed: number, partial: ReadonlyArray<EvalResult | Error | undefined>) => void;
  concurrency?: number;
  gapMs?: number;
  passThreshold?: number;
};

export async function runEval(
  parsed: ParsedSpec,
  rubric: Rubric,
  tests: TestCase[],
  options: RunEvalOptions = {},
): Promise<{ results: EvalResult[]; summary: Summary }> {
  const passThreshold = options.passThreshold ?? PASS_THRESHOLD_DEFAULT;
  const concurrency = options.concurrency ?? 2;
  const gapMs = options.gapMs ?? 4000;

  const judgeOne = async (test: TestCase): Promise<EvalResult> => {
    const raw = await generateJSON<RawJudge>(buildRunEvalPrompt(parsed, rubric, test));
    const scores = raw.scores ?? [];
    const passedScore = weightedOverall(scores, rubric);
    const output =
      typeof raw.output === 'string'
        ? raw.output
        : raw.output == null
          ? ''
          : JSON.stringify(raw.output);
    return {
      testId: test.id,
      output,
      scores,
      passed: passedScore >= passThreshold,
    };
  };

  const partial = await runBatched<TestCase, EvalResult>(tests, judgeOne, {
    concurrency,
    gapMs,
    signal: options.signal,
    onProgress: options.onProgress,
  });

  const results: EvalResult[] = partial.map((r, i) =>
    r instanceof Error
      ? { testId: tests[i].id, output: '', scores: [], passed: false }
      : (r as EvalResult),
  );

  const summary = summarize(results, rubric, passThreshold);
  return { results, summary };
}
