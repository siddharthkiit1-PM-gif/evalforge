import type { AgentIteration, StopReason } from '@/lib/agent/types';
import type { Summary } from '@/lib/scoring';

const MAX_ITERATIONS = 5;
const NO_IMPROVEMENT_THRESHOLD = 0.05;

export function shouldTrigger(summary: Summary, threshold: number): boolean {
  if (summary.overall < threshold) return true;
  return Object.values(summary.perDimension).some((s) => s < threshold);
}

export function weakestDimension(summary: Summary): string | null {
  const entries = Object.entries(summary.perDimension);
  if (entries.length === 0) return null;
  return entries.reduce((min, cur) => (cur[1] < min[1] ? cur : min))[0];
}

function allPass(summary: Summary, threshold: number): boolean {
  if (summary.overall < threshold) return false;
  return Object.values(summary.perDimension).every((s) => s >= threshold);
}

export function shouldStop(history: AgentIteration[], threshold: number): StopReason | null {
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  if (allPass(latest.summaryAfter, threshold)) return 'all-pass';
  if (history.length >= MAX_ITERATIONS) return 'iteration-cap';
  if (history.length >= 2) {
    const prev = history[history.length - 2];
    if (
      latest.weakestDeltaSinceLast < NO_IMPROVEMENT_THRESHOLD &&
      prev.weakestDeltaSinceLast < NO_IMPROVEMENT_THRESHOLD
    ) {
      return 'no-improvement';
    }
  }
  return null;
}
