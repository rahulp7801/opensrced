// Reading a server-sent-event response from the browser.
//
// This exists because every hand-rolled copy of it made the same mistake. The
// API routes stream SSE on the happy path and return plain
// `Response.json({ error }, { status })` for 400/401/404/429/500. Draining an
// error body for `data:` lines yields nothing at all, the read loop ends
// having set no state, and whatever the caller does next runs as if the
// stream had completed normally — which showed up as a build stuck on
// "building..." forever, and as a failed fix reported to the user as
// "Complete" with an empty body.
//
// So the status check belongs with the parsing, not next to each caller.

/**
 * Yield the parsed `data:` payloads of an SSE response.
 *
 * Throws on a non-OK response, preferring the server's own `error` message.
 * Malformed individual events are skipped rather than failing the stream: a
 * truncated final chunk is normal, a corrupt payload is not worth discarding
 * the events that already arrived.
 */
export async function* sseEvents<T>(res: Response): AsyncGenerator<T> {
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: { error?: string }) => d?.error)
      .catch(() => null);
    throw new Error(detail ?? `Request failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty response from server");

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error("Stream event exceeded its size limit.");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let event: T;
        try { event = JSON.parse(line.slice(5).trimStart()) as T; }
        catch { continue; }
        yield event;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
