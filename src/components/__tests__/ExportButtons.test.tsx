import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportButtons from '@/components/ExportButtons';
import type { EvalResult, Rubric, TestCase, ParsedSpec } from '@/lib/types';
import type { Summary } from '@/lib/scoring';

const props: {
  spec: string;
  parsed: ParsedSpec;
  tests: TestCase[];
  rubric: Rubric;
  results: EvalResult[];
  summary: Summary;
} = {
  spec: 's',
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  tests: [],
  rubric: { dimensions: [{ id: 'a', label: 'A', description: '', weight: 1 }] },
  results: [
    {
      testId: 't1',
      output: 'x',
      passed: true,
      scores: [{ dimensionId: 'a', score: 0.9, reasoning: 'r' }],
    },
  ],
  summary: { overall: 0.9, passedCount: 1, perDimension: { a: 0.9 } },
};

describe('ExportButtons', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads bundle JSON when bundle button clicked', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    render(<ExportButtons {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /bundle/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });

  it('downloads results JSON when results button clicked', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    render(<ExportButtons {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /results json/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });

  it('downloads CSV when CSV button clicked', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    render(<ExportButtons {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /csv/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });
});
