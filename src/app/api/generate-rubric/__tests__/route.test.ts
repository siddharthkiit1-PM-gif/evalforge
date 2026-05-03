import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/generate-rubric/route';
import { readSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, Rubric, RefinementEvent } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({ generateJSON: vi.fn() }));

import { generateJSON } from '@/lib/gemini';

const sampleParsed: ParsedSpec = {
  feature: 'Extracts obligations.',
  inputs: ['contract pdf'],
  outputs: ['table'],
  constraints: ['due date'],
  domain: 'legal',
};

const sampleRubric: Rubric = {
  dimensions: [
    { id: 'a', label: 'A', description: 'd', weight: 0.25 },
    { id: 'b', label: 'B', description: 'd', weight: 0.25 },
    { id: 'c', label: 'C', description: 'd', weight: 0.25 },
    { id: 'd', label: 'D', description: 'd', weight: 0.25 },
  ],
};

const cleanCritique = { issues: [] };

function jsonReq(body: unknown): Request {
  return new Request('http://test/api/generate-rubric', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(generateJSON).mockReset();
});

describe('POST /api/generate-rubric (SSE)', () => {
  it('rejects non-JSON body with 400', async () => {
    const req = new Request('http://test/api/generate-rubric', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects body without parsed with 400', async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(400);
  });

  it('streams a clean run when first critique is empty', async () => {
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleRubric)
      .mockResolvedValueOnce(cleanCritique);
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = await readSSEStream<RefinementEvent<Rubric>>(res);
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'done',
    ]);
  });

  it('streams a revise round when critique flags majors', async () => {
    const issue = {
      field: 'dimensions[0].weight',
      severity: 'major' as const,
      description: 'sum',
      suggestion: 'rebalance',
    };
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleRubric)
      .mockResolvedValueOnce({ issues: [issue] })
      .mockResolvedValueOnce(sampleRubric)
      .mockResolvedValueOnce(cleanCritique);
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    const events = await readSSEStream<RefinementEvent<Rubric>>(res);
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
    vi.mocked(generateJSON).mockRejectedValueOnce(new Error('boom'));
    const res = await POST(jsonReq({ parsed: sampleParsed }));
    const events = await readSSEStream<RefinementEvent<Rubric>>(res);
    expect(events.map((e) => e.type)).toEqual(['error']);
  });
});
