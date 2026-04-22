// Simple in-memory + disk LLM response cache.
// Caches Anthropic API responses keyed by a hash of (model + system + messages).
// TTL: 1 hour in memory, 24 hours on disk.
// Saves tokens by returning cached responses for identical or near-identical queries.

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = join(homedir(), ".opensrcer", "llm-cache");
const MEMORY_TTL_MS = 60 * 60 * 1000; // 1 hour
const DISK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type CacheEntry = {
  response: string;
  model: string;
  cachedAt: number;
  inputTokens: number;
  outputTokens: number;
};

// In-memory cache for hot queries
const memoryCache = new Map<string, CacheEntry>();

function hashKey(model: string, system: string, userMessage: string): string {
  const content = `${model}::${system}::${userMessage}`;
  return createHash("sha256").update(content).digest("hex").slice(0, 24);
}

function diskPath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

export async function getCached(
  model: string,
  system: string,
  userMessage: string,
): Promise<CacheEntry | null> {
  const key = hashKey(model, system, userMessage);

  // Check memory first
  const memEntry = memoryCache.get(key);
  if (memEntry && Date.now() - memEntry.cachedAt < MEMORY_TTL_MS) {
    return memEntry;
  }

  // Check disk
  const path = diskPath(key);
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, "utf8");
      const entry = JSON.parse(raw) as CacheEntry;
      if (Date.now() - entry.cachedAt < DISK_TTL_MS) {
        // Promote to memory
        memoryCache.set(key, entry);
        return entry;
      }
    } catch {
      // Corrupt cache file — ignore
    }
  }

  return null;
}

export async function setCached(
  model: string,
  system: string,
  userMessage: string,
  response: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const key = hashKey(model, system, userMessage);
  const entry: CacheEntry = {
    response,
    model,
    cachedAt: Date.now(),
    inputTokens,
    outputTokens,
  };

  // Save to memory
  memoryCache.set(key, entry);

  // Persist to disk (best-effort)
  try {
    if (!existsSync(CACHE_DIR)) {
      await mkdir(CACHE_DIR, { recursive: true });
    }
    await writeFile(diskPath(key), JSON.stringify(entry));
  } catch {
    // Disk write failed — memory cache still works
  }
}

// Stats for monitoring
export function cacheStats(): { memoryEntries: number; hitRate: string } {
  return {
    memoryEntries: memoryCache.size,
    hitRate: "tracked per-route",
  };
}
