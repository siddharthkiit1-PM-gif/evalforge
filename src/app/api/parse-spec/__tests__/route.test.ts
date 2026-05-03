import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/parse-spec/route';
import { readSSEStream } from '@/test/sse-stream';
import type { ParsedSpec, RefinementEvent } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { generateJSON } from '@/lib/gemini';

const sampleParsed: ParsedSpec = {
  feature: 'Extracts obligations from contracts.',
  inputs: ['contract pdf'],
  outputs: ['table of obligations'],
  constraints: ['include due date'],
  domain: 'legal',
};

const cleanCritique = { issues: [] };

function jsonReq(body: unknown): Request {
  return new Request('http://test/api/parse-spec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(generateJSON).mockReset();
});

describe('POST /api/parse-spec (SSE)', () => {
  it('rejects non-JSON body with 400 (no SSE)', async () => {
    const req = new Request('http://test/api/parse-spec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/json/);
  });

  it('rejects empty spec with 400', async () => {
    const res = await POST(jsonReq({ spec: '   ' }));
    expect(res.status).toBe(400);
  });

  it('streams generated → critiquing → critiqued → done when first critique is clean', async () => {
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleParsed)        // generate
      .mockResolvedValueOnce(cleanCritique);      // critique pass 1
    const res = await POST(jsonReq({ spec: 'AI parses contracts.' }));
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = await readSSEStream<RefinementEvent<ParsedSpec>>(res);
    expect(events.map((e) => e.type)).toEqual([
      'generated',
      'critiquing',
      'critiqued',
      'done',
    ]);
  });

  it('streams a full revise round when first critique flags major issues, then exits', async () => {
    const issue = {
      field: 'feature',
      severity: 'major' as const,
      description: 'too vague',
      suggestion: 'be specific',
    };
    vi.mocked(generateJSON)
      .mockResolvedValueOnce(sampleParsed)                          // generate
      .mockResolvedValueOnce({ issues: [issue] })                   // critique 1
      .mockResolvedValueOnce({ ...sampleParsed, feature: 'better' })// revise 1
      .mockResolvedValueOnce(cleanCritique);                        // critique 2
    const res = await POST(jsonReq({ spec: 'AI parses contracts.' }));
    const events = await readSSEStream<RefinementEvent<ParsedSpec>>(res);
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

  it('emits an error event when generate throws', async () => {
    vi.mocked(generateJSON).mockRejectedValueOnce(new Error('gemini down'));
    const res = await POST(jsonReq({ spec: 'AI parses contracts.' }));
    const events = await readSSEStream<RefinementEvent<ParsedSpec>>(res);
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect((events[0] as { message: string }).message).toContain('gemini down');
  });
});
