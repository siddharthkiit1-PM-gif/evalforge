import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { POST } from '@/app/api/parse-spec/route';
import { generateJSON } from '@/lib/gemini';

const mockedGenerateJSON = vi.mocked(generateJSON);

beforeEach(() => {
  mockedGenerateJSON.mockReset();
});

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/parse-spec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/parse-spec', () => {
  it('returns the parsed spec on success', async () => {
    mockedGenerateJSON.mockResolvedValueOnce({
      feature: 'Cold email drafter',
      inputs: ['LinkedIn profile'],
      outputs: ['email under 150 words'],
      constraints: ['one case study'],
      domain: 'sales',
    });

    const res = await POST(makeRequest({ spec: 'AI drafts cold emails.' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      feature: 'Cold email drafter',
      inputs: ['LinkedIn profile'],
      outputs: ['email under 150 words'],
      constraints: ['one case study'],
      domain: 'sales',
    });
    expect(mockedGenerateJSON).toHaveBeenCalledOnce();
    const promptArg = mockedGenerateJSON.mock.calls[0][0];
    expect(promptArg).toContain('AI drafts cold emails.');
  });

  it('returns 400 when spec is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/spec/i);
    expect(mockedGenerateJSON).not.toHaveBeenCalled();
  });

  it('returns 400 when spec is empty after trim', async () => {
    const res = await POST(makeRequest({ spec: '   ' }));
    expect(res.status).toBe(400);
    expect(mockedGenerateJSON).not.toHaveBeenCalled();
  });

  it('returns 500 when Gemini throws', async () => {
    mockedGenerateJSON.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(makeRequest({ spec: 'a real spec' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
