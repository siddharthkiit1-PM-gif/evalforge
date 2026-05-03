import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/generate-tests/route';
import { readSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, TestCase, RefinementEvent } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';

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
  input: `sample input ${i + 1}`,
}));

const cleanCritique = { issues: [] };

function jsonReq(body: unknown): Request {
  return new Request('http://test/api/generate-tests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(generateJSON).mockReset();
});

describe('POST /api/generate-tests (SSE)', () => {
  it('rejects non-JSON body with 400', async () => {
    const req = new Request('http://test/api/generate-tests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects body without parsed field with 400', async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(400);
  });

  it('streams a clean run when first critique returns no issues', async () => {
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleTests)
      .mockResolvedValueOnce(cleanCritique);
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = await readSSEStream<RefinementEvent<TestCase[]>>(res);
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'done',
    ]);
  });

  it('streams a revise round when first critique flags major issues', async () => {
    const issue = {
      field: 'tests[10].category',
      severity: 'major' as const,
      description: 'mislabeled',
      suggestion: 'fix',
    };
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleTests)
      .mockResolvedValueOnce({ issues: [issue] })
      .mockResolvedValueOnce(sampleTests)
      .mockResolvedValueOnce(cleanCritique);
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    const events = await readSSEStream<RefinementEvent<TestCase[]>>(res);
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
  });

  it('emits error when generate throws', async () => {
    vi.mocked(generateJSON).mockRejectedValueOnce(new Error('gemini fail'));
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    const events = await readSSEStream<RefinementEvent<TestCase[]>>(res);
    expect(events.map((e) => e.type)).toEqual(['error']);
  });
});
