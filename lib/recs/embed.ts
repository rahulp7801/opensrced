// Voyage embeddings for issue text (PLAN.md §6.1, D12). Paid by the platform
// from Voyage's free tokens, so only the catalog is embedded. Without
// VOYAGE_API_KEY nothing is embedded and similarity runs on full text and
// graph overlap alone (lib/recs/similar.ts renormalises its weights).

import { EMBEDDING_DIMENSIONS } from "../db/schema";

export const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_MODEL = "voyage-3.5";
/** Voyage takes up to 1,000 inputs per request; 128 keeps one request well
 *  under its 320k-token cap even with 1.5k-character bodies. */
export const EMBED_BATCH = 128;
/** The plan embeds the title plus the body's first 1.5k characters. */
export const EMBED_BODY_CHARS = 1_500;

export class EmbeddingError extends Error {
  constructor(message: string) { super(message); this.name = "EmbeddingError"; }
}

/** Read at call time so a key added to the env takes effect without a rebuild. */
export function embeddingsEnabled(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

export function issueEmbeddingText(title: string, body: string): string {
  return `${title}\n\n${body.slice(0, EMBED_BODY_CHARS)}`;
}

type Options = { fetch?: typeof fetch; apiKey?: string; inputType?: "document" | "query"; signal?: AbortSignal };

/** One vector per text, in order. Throws when no key is configured: callers
 *  check embeddingsEnabled() first, so a missing key is a decision, not a
 *  silent no-op deep inside a batch. */
export async function embedTexts(texts: string[], options: Options = {}): Promise<number[][]> {
  const apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new EmbeddingError("VOYAGE_API_KEY is not set");
  const doFetch = options.fetch ?? fetch;
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const input = texts.slice(start, start + EMBED_BATCH).map((text) => text || " ");
    const response = await doFetch(VOYAGE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ input, model: VOYAGE_MODEL, input_type: options.inputType ?? "document", output_dimension: EMBEDDING_DIMENSIONS }),
      signal: options.signal ?? AbortSignal.timeout(60_000),
    });
    // Voyage's error bodies never echo the key; the status is enough to act on.
    if (!response.ok) throw new EmbeddingError(`Voyage embeddings failed with HTTP ${response.status}`);
    const { data } = await response.json() as { data?: Array<{ embedding: number[]; index: number }> };
    if (!Array.isArray(data) || data.length !== input.length) throw new EmbeddingError("Voyage returned the wrong number of embeddings");
    for (const item of [...data].sort((a, b) => a.index - b.index)) {
      if (!Array.isArray(item.embedding) || item.embedding.length !== EMBEDDING_DIMENSIONS) throw new EmbeddingError("Voyage returned an embedding of the wrong size");
      vectors.push(item.embedding);
    }
  }
  return vectors;
}
