import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agent/loop', () => ({
  runAgentLoop: vi.fn(),
}));

import { runAgentLoop } from '@/lib/agent/loop';
import { POST } from '@/app/api/improve/route';
import type { AgentEvent } from '@/lib/agent/types';

const validBody = {
  parsed: { feature: 'f', inputs: [], outputs: [], constraints: [], domain: 'general' },
  rubric: { dimensions: [{ id: 'd', label: 'D', description: '', weight: 1 }] },
  tests: [{ id: 'test-01', category: 'happy_path', input: 'a' }],
  results: [],
  summary: { overall: 0.5, passedCount: 0, perDimension: { d: 0.5 } },
};

async function readSSE(res: Response): Promise<AgentEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events: AgentEvent[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }
  return events;
}

describe('POST /api/improve', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 on invalid body', async () => {
    const req = new Request('http://localhost/api/improve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parsed: 'nope' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('streams agent events on valid body', async () => {
    (runAgentLoop as unknown as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield { type: 'started', snapshot: {}, threshold: 0.7, maxIterations: 5 } as AgentEvent;
      yield { type: 'iteration-start', iteration: 1 } as AgentEvent;
      yield {
        type: 'committed',
        finalState: {} as never,
        diff: {} as never,
      } as AgentEvent;
    });
    const req = new Request('http://localhost/api/improve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await readSSE(res);
    expect(events.map((e) => e.type)).toEqual(['started', 'iteration-start', 'committed']);
  });

  it('emits error frame if loop throws', async () => {
    (runAgentLoop as unknown as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield { type: 'started', snapshot: {}, threshold: 0.7, maxIterations: 5 } as AgentEvent;
      throw new Error('loop crash');
    });
    const req = new Request('http://localhost/api/improve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    const events = await readSSE(res);
    expect(events.some((e) => e.type === 'error' && /loop crash/.test(e.message))).toBe(true);
  });
});
