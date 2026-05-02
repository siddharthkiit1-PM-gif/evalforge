import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedSpec, Rubric } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { POST } from '@/app/api/generate-rubric/route';
import { generateJSON } from '@/lib/gemini';

const mockedGenerateJSON = vi.mocked(generateJSON);

beforeEach(() => {
  mockedGenerateJSON.mockReset();
});

const PARSED: ParsedSpec = {
  feature: 'Cold email drafter',
  inputs: ['profile'],
  outputs: ['email'],
  constraints: ['under 150 words'],
  domain: 'sales',
};

const RUBRIC: Rubric = {
  dimensions: [
    { id: 'personalization', label: 'Personalization', description: 'Refers to a specific profile detail.', weight: 0.5 },
    { id: 'concision', label: 'Concision', description: 'Stays under 150 words.', weight: 0.5 },
  ],
};

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/generate-rubric', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate-rubric', () => {
  it('returns the rubric on success', async () => {
    mockedGenerateJSON.mockResolvedValueOnce(RUBRIC);
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RUBRIC);
  });

  it('returns 400 when parsed is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 500 when Gemini returns no dimensions', async () => {
    mockedGenerateJSON.mockResolvedValueOnce({ dimensions: [] });
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(500);
  });

  it('returns 500 when Gemini throws', async () => {
    mockedGenerateJSON.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(500);
  });

  it('passes parsed spec context into the prompt', async () => {
    mockedGenerateJSON.mockResolvedValueOnce(RUBRIC);
    await POST(makeRequest({ parsed: PARSED }));
    const promptArg = mockedGenerateJSON.mock.calls[0][0];
    expect(promptArg).toContain('Cold email drafter');
    expect(promptArg).toContain('sales');
  });
});
