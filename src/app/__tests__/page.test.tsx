import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Home from '@/app/page';
import { mockSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, Rubric, TestCase } from '@/lib/types';

const sampleParsed: ParsedSpec = {
  feature: 'Extracts obligations.',
  inputs: ['contract pdf'],
  outputs: ['table'],
  constraints: ['due date'],
  domain: 'legal',
};

const sampleTests: TestCase[] = Array.from({ length: 20 }, (_, i) => ({
  id: `test-${String(i + 1).padStart(2, '0')}`,
  category: i < 8 ? 'happy_path' : i < 15 ? 'edge_case' : 'adversarial',
  input: `input ${i + 1}`,
}));

const sampleRubric: Rubric = {
  dimensions: [
    { id: 'a', label: 'A', description: 'd', weight: 0.5 },
    { id: 'b', label: 'B', description: 'd', weight: 0.5 },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetchSequence(streams: Response[]) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = streams[i++];
      if (!next) throw new Error('unexpected fetch call');
      return next;
    }),
  );
}

describe('Home page (SSE pipeline)', () => {
  it('renders the spec form on mount', () => {
    render(<Home />);
    expect(screen.getByPlaceholderText(/spec/i)).toBeInTheDocument();
  });

  it('runs all three stages end-to-end and shows the final UI', async () => {
    mockFetchSequence([
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleParsed },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleParsed },
      ]),
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleTests },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleTests },
      ]),
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleRubric },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleRubric },
      ]),
    ]);
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/spec/i), {
      target: { value: 'AI extracts obligations.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText(/Plan C wires the runner/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Test suite \(20\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Rubric/i)).toBeInTheDocument();
  });

  it('shows critiquing pass counter in the status text', async () => {
    mockFetchSequence([
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleParsed },
        { type: 'critiquing', pass: 1 },
        // hold here so we can assert mid-run
      ]),
    ]);
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/spec/i), {
      target: { value: 'spec' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText(/Critiquing parsed spec \(pass 1\/2\)/i)).toBeInTheDocument(),
    );
  });

  it('renders an error message when a stage emits an error event', async () => {
    mockFetchSequence([
      mockSSEStream([{ type: 'error', message: 'gemini down' }]),
    ]);
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/spec/i), {
      target: { value: 'spec' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText(/gemini down/i)).toBeInTheDocument(),
    );
  });

  it('preserves recoverable=false from a server-emitted SSE error event', async () => {
    // Regression: previously the reducer wrote `recoverable: false` for SSE
    // `error` frames, then runStage threw and the catch in run() dispatched
    // STAGE_ERR with `recoverable: true`, silently downgrading the severity.
    mockFetchSequence([
      mockSSEStream([{ type: 'error', message: 'fatal upstream' }]),
    ]);
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/spec/i), {
      target: { value: 'spec' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    const errEl = await screen.findByTestId('pipeline-error');
    expect(errEl).toHaveTextContent(/fatal upstream/i);
    expect(errEl).toHaveAttribute('data-recoverable', 'false');
  });

  it('updates the test table live when a revised event arrives', async () => {
    const v0 = sampleTests.map((t, i) => (i === 0 ? { ...t, input: 'OLD' } : t));
    const v1 = sampleTests.map((t, i) => (i === 0 ? { ...t, input: 'NEW' } : t));
    mockFetchSequence([
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleParsed },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleParsed },
      ]),
      mockSSEStream([
        { type: 'generated', pass: 0, output: v0 },
        { type: 'critiquing', pass: 1 },
        {
          type: 'critiqued',
          pass: 1,
          issues: [
            {
              field: 'tests[0].input',
              severity: 'major',
              description: 'too vague',
              suggestion: 'be specific',
            },
          ],
        },
        { type: 'revising', pass: 1 },
        { type: 'revised', pass: 1, output: v1 },
        { type: 'critiquing', pass: 2 },
        { type: 'critiqued', pass: 2, issues: [] },
        { type: 'done', output: v1 },
      ]),
      mockSSEStream([
        { type: 'generated', pass: 0, output: sampleRubric },
        { type: 'critiquing', pass: 1 },
        { type: 'critiqued', pass: 1, issues: [] },
        { type: 'done', output: sampleRubric },
      ]),
    ]);
    render(<Home />);
    fireEvent.change(screen.getByPlaceholderText(/spec/i), {
      target: { value: 'spec' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() =>
      expect(screen.getByText(/Plan C wires the runner/i)).toBeInTheDocument(),
    );
    expect(screen.getByText('NEW')).toBeInTheDocument();
    expect(screen.queryByText('OLD')).not.toBeInTheDocument();
  });
});
