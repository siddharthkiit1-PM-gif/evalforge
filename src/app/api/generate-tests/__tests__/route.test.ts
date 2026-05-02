import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedSpec, TestCase } from '@/lib/types';

vi.mock('@/lib/gemini', () => ({
  generateJSON: vi.fn(),
}));

import { POST } from '@/app/api/generate-tests/route';
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

function makeTests(n: number): TestCase[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `test-${String(i + 1).padStart(2, '0')}`,
    category: 'happy_path' as const,
    input: `input ${i + 1}`,
  }));
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/generate-tests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate-tests', () => {
  it('returns the test list on success', async () => {
    const tests = makeTests(20);
    mockedGenerateJSON.mockResolvedValueOnce(tests);
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tests).toHaveLength(20);
    expect(body.tests[0].id).toBe('test-01');
  });

  it('returns 400 when parsed is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockedGenerateJSON).not.toHaveBeenCalled();
  });

  it('returns 500 when Gemini returns fewer than 1 test', async () => {
    mockedGenerateJSON.mockResolvedValueOnce([]);
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/test/i);
  });

  it('returns 500 when Gemini throws', async () => {
    mockedGenerateJSON.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(makeRequest({ parsed: PARSED }));
    expect(res.status).toBe(500);
  });

  it('passes parsed spec context into the prompt', async () => {
    mockedGenerateJSON.mockResolvedValueOnce(makeTests(20));
    await POST(makeRequest({ parsed: PARSED }));
    const promptArg = mockedGenerateJSON.mock.calls[0][0];
    expect(promptArg).toContain('Cold email drafter');
    expect(promptArg).toContain('sales');
  });
});
