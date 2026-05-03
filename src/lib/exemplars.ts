import type { Domain } from '@/lib/types';

export type ExemplarStage = 'tests' | 'rubric';

export type Exemplar = {
  /** A short illustrative spec snippet (~2-4 sentences). */
  spec: string;
  /** The ideal model output as a JSON string. For 'tests' it parses as TestCase[]; for 'rubric' it parses as Rubric. */
  output: string;
  /** 1-2 sentence rationale, inlined into the prompt. */
  rationale: string;
};

export type ExemplarTable = Record<Domain, Record<ExemplarStage, Exemplar[]>>;

// Content is filled in by Task 2. Kept as empty arrays here so the module type-checks.
export const EXEMPLARS: ExemplarTable = {
  legal: { tests: [], rubric: [] },
  sales: { tests: [], rubric: [] },
  healthcare: { tests: [], rubric: [] },
  general: { tests: [], rubric: [] },
};

export function selectExemplars(domain: Domain | string, stage: ExemplarStage): Exemplar[] {
  const d = Object.hasOwn(EXEMPLARS, domain) ? (domain as Domain) : 'general';
  return EXEMPLARS[d][stage];
}
