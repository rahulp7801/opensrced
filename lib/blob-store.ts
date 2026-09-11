import { get, put, BlobPreconditionFailedError } from "@vercel/blob";

export const privateJsonOptions = { access: "private" as const, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 };

export async function readJson<T>(path: string, maxBytes = 600_000): Promise<{ value: T; etag: string } | null> {
  const blob = await get(path, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(15_000) });
  if (!blob || blob.statusCode !== 200) return null;
  if (blob.blob.size > maxBytes) throw new Error("Stored record exceeds size limit");
  return { value: await new Response(blob.stream).json() as T, etag: blob.blob.etag };
}

/** Retry concurrent updates against the latest value instead of losing writes. */
export async function updateJson<T>(path: string, initial: T, update: (value: T) => T): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readJson<T>(path);
    try {
      await put(path, JSON.stringify(update(current ? current.value : initial)), {
        ...privateJsonOptions, allowOverwrite: !!current,
        ...(current ? { ifMatch: current.etag } : {}), abortSignal: AbortSignal.timeout(15_000),
      });
      return;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || (error instanceof Error && /already exists/i.test(error.message))) continue;
      throw error;
    }
  }
  throw new Error("Concurrent storage update failed; please retry.");
}
