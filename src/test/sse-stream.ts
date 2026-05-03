// Builds a fake SSE Response from a list of events.
// Each event is serialized as one `data: <json>\n\n` frame.
// Used by route-handler tests and page integration tests.
export function mockSSEStream(events: object[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

// Drains an SSE Response (as produced by a route handler) into an array
// of parsed event objects. Used by route-handler tests to assert the
// frame sequence emitted by a real handler.
export async function readSSEStream<T = unknown>(res: Response): Promise<T[]> {
  if (!res.body) throw new Error('Response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const out: T[] = [];
  // SSE frames are separated by a blank line ("\n\n"). We accumulate raw
  // chunks, split on the delimiter, and parse the `data: ` payload.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) out.push(JSON.parse(line.slice(6)) as T);
    }
  }
  return out;
}
