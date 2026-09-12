const DEFAULT_MAX_BYTES = 1_000_000;

async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) return null;
  }
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Read text without allowing an unbounded request stream into memory. */
export async function readTextBody(request: Request, maxBytes = DEFAULT_MAX_BYTES): Promise<string | null> {
  const body = await readBodyBytes(request, maxBytes);
  if (!body) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

/** Parse JSON without allowing an unbounded request stream into memory. */
export async function readJsonBody<T = unknown>(request: Request, maxBytes = DEFAULT_MAX_BYTES): Promise<T | null> {
  const text = await readTextBody(request, maxBytes);
  if (text === null) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}
