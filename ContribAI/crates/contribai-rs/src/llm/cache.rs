//! Content-addressable LLM response cache.
//!
//! Caches LLM responses by SHA-256 hash of (model + system_prompt + user_prompt).
//! Subsequent identical requests return the cached response without hitting the API.
//!
//! TTL: 7 days (configurable).

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tracing::{debug, info};

use crate::core::error::Result;

const CACHE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS llm_cache (
    prompt_hash TEXT PRIMARY KEY,
    model       TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    user_prompt  TEXT NOT NULL,
    response     TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_cache(expires_at);
"#;

/// LLM response cache with TTL.
pub struct LlmCache {
    db: Mutex<Connection>,
    ttl: Duration,
}

impl LlmCache {
    /// Create a new cache backed by a SQLite database.
    pub fn new(db_path: &Path, ttl_days: u64) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(db_path).map_err(|e| {
            crate::core::error::ContribError::Database(format!("Cache open: {}", e))
        })?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| crate::core::error::ContribError::Database(format!("WAL: {}", e)))?;

        conn.execute_batch(CACHE_SCHEMA)
            .map_err(|e| crate::core::error::ContribError::Database(format!("Schema: {}", e)))?;

        info!(path = ?db_path, ttl_days, "LLM cache initialized");
        Ok(Self {
            db: Mutex::new(conn),
            ttl: Duration::from_secs(ttl_days * 86400),
        })
    }

    /// Compute the cache key for a given prompt/model/system combination.
    pub fn compute_hash(model: &str, system: &str, prompt: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(model.as_bytes());
        hasher.update(system.as_bytes());
        hasher.update(prompt.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Look up a cached response. Returns None on miss or expiry.
    pub fn get(&self, prompt_hash: &str) -> Result<Option<String>> {
        let db = self.db.lock().map_err(|e| {
            crate::core::error::ContribError::Database(format!("Cache lock poisoned: {}", e))
        })?;

        let now = chrono::Utc::now().to_rfc3339();
        let response: Option<String> = db
            .query_row(
                "SELECT response FROM llm_cache WHERE prompt_hash = ? AND expires_at > ?",
                params![prompt_hash, now],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| {
                crate::core::error::ContribError::Database(format!("Cache read: {}", e))
            })?;

        if response.is_some() {
            debug!(hash = prompt_hash, "LLM cache hit");
        }
        Ok(response)
    }

    /// Store a response in the cache.
    pub fn put(
        &self,
        prompt_hash: &str,
        model: &str,
        system_prompt: &str,
        user_prompt: &str,
        response: &str,
    ) -> Result<()> {
        let db = self.db.lock().map_err(|e| {
            crate::core::error::ContribError::Database(format!("Cache lock poisoned: {}", e))
        })?;

        let now = chrono::Utc::now();
        let expires = now + chrono::Duration::from_std(self.ttl).unwrap();

        db.execute(
            "INSERT OR REPLACE INTO llm_cache (prompt_hash, model, system_prompt, user_prompt, response, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                prompt_hash,
                model,
                system_prompt,
                user_prompt,
                response,
                now.to_rfc3339(),
                expires.to_rfc3339(),
            ],
        )
        .map_err(|e| crate::core::error::ContribError::Database(format!("Cache write: {}", e)))?;

        debug!(hash = prompt_hash, "LLM cache stored");
        Ok(())
    }

    /// Clear expired entries from the cache.
    pub fn prune_expired(&self) -> Result<usize> {
        let db = self.db.lock().map_err(|e| {
            crate::core::error::ContribError::Database(format!("Cache lock poisoned: {}", e))
        })?;

        let now = chrono::Utc::now().to_rfc3339();
        let count = db
            .execute("DELETE FROM llm_cache WHERE expires_at <= ?", params![now])
            .map_err(|e| {
                crate::core::error::ContribError::Database(format!("Cache prune: {}", e))
            })?;

        if count > 0 {
            info!(pruned = count, "LLM cache: pruned expired entries");
        }
        Ok(count)
    }

    /// Clear the entire cache.
    pub fn clear(&self) -> Result<usize> {
        let db = self.db.lock().map_err(|e| {
            crate::core::error::ContribError::Database(format!("Cache lock poisoned: {}", e))
        })?;

        let count = db.execute("DELETE FROM llm_cache", []).map_err(|e| {
            crate::core::error::ContribError::Database(format!("Cache clear: {}", e))
        })?;

        info!(cleared = count, "LLM cache cleared");
        Ok(count)
    }

    /// Get cache statistics.
    pub fn stats(&self) -> Result<CacheStats> {
        let db = self.db.lock().map_err(|e| {
            crate::core::error::ContribError::Database(format!("Cache lock poisoned: {}", e))
        })?;

        let total: i64 = db
            .query_row("SELECT COUNT(*) FROM llm_cache", [], |row| row.get(0))
            .unwrap_or(0);

        let now = chrono::Utc::now().to_rfc3339();
        let valid: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM llm_cache WHERE expires_at > ?",
                params![now],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let expired: i64 = total - valid;

        let db_size: i64 = db
            .query_row(
                "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok(CacheStats {
            total,
            valid,
            expired,
            db_size_bytes: db_size as u64,
        })
    }
}

/// Cache statistics.
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub total: i64,
    pub valid: i64,
    pub expired: i64,
    pub db_size_bytes: u64,
}

/// A wrapper that adds caching to a `Box<dyn LlmProvider>`.
pub struct CachedLlmProvider {
    inner: Box<dyn crate::llm::provider::LlmProvider>,
    cache: LlmCache,
    model_name: String,
    pub hits: std::sync::atomic::AtomicU64,
    pub misses: std::sync::atomic::AtomicU64,
}

impl CachedLlmProvider {
    pub fn new(
        inner: Box<dyn crate::llm::provider::LlmProvider>,
        cache: LlmCache,
        model_name: String,
    ) -> Self {
        Self {
            inner,
            cache,
            model_name,
            hits: std::sync::atomic::AtomicU64::new(0),
            misses: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub fn cache(&self) -> &LlmCache {
        &self.cache
    }
}

#[async_trait::async_trait]
impl crate::llm::provider::LlmProvider for CachedLlmProvider {
    async fn complete(
        &self,
        prompt: &str,
        system: Option<&str>,
        temperature: Option<f64>,
        max_tokens: Option<u32>,
    ) -> crate::core::error::Result<String> {
        let system_str = system.unwrap_or("");
        let hash = LlmCache::compute_hash(&self.model_name, system_str, prompt);

        // Check cache
        if let Some(cached) = self.cache.get(&hash)? {
            self.hits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            return Ok(cached);
        }

        // Cache miss — call inner provider
        self.misses
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let response = self
            .inner
            .complete(prompt, system, temperature, max_tokens)
            .await?;

        // Store in cache
        let _ = self
            .cache
            .put(&hash, &self.model_name, system_str, prompt, &response);

        Ok(response)
    }

    async fn chat(
        &self,
        messages: &[crate::llm::provider::ChatMessage],
        system: Option<&str>,
        temperature: Option<f64>,
        max_tokens: Option<u32>,
    ) -> crate::core::error::Result<String> {
        // Chat mode is not cached — each conversation is unique
        self.inner
            .chat(messages, system, temperature, max_tokens)
            .await
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_cache() -> LlmCache {
        let path = std::env::temp_dir().join(format!(
            "contribai_test_cache_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        LlmCache::new(&path, 7).unwrap()
    }

    #[test]
    fn test_compute_hash_deterministic() {
        let h1 = LlmCache::compute_hash("gemini", "system", "prompt");
        let h2 = LlmCache::compute_hash("gemini", "system", "prompt");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // SHA-256 hex
    }

    #[test]
    fn test_compute_hash_different_inputs() {
        let h1 = LlmCache::compute_hash("gemini", "system", "prompt1");
        let h2 = LlmCache::compute_hash("gemini", "system", "prompt2");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_cache_get_put() {
        let cache = temp_cache();
        let hash = LlmCache::compute_hash("gemini", "sys", "user prompt");

        // Miss
        assert!(cache.get(&hash).unwrap().is_none());

        // Store
        cache
            .put(&hash, "gemini", "sys", "user prompt", "cached response")
            .unwrap();

        // Hit
        let response = cache.get(&hash).unwrap();
        assert_eq!(response.as_deref(), Some("cached response"));
    }

    #[test]
    fn test_cache_overwrite() {
        let cache = temp_cache();
        let hash = LlmCache::compute_hash("gemini", "sys", "prompt");

        cache.put(&hash, "gemini", "sys", "prompt", "v1").unwrap();
        cache.put(&hash, "gemini", "sys", "prompt", "v2").unwrap();

        assert_eq!(cache.get(&hash).unwrap().as_deref(), Some("v2"));
    }

    #[test]
    fn test_cache_clear() {
        let cache = temp_cache();
        let hash = LlmCache::compute_hash("gemini", "sys", "prompt");
        cache
            .put(&hash, "gemini", "sys", "prompt", "response")
            .unwrap();

        let cleared = cache.clear().unwrap();
        assert_eq!(cleared, 1);
        assert!(cache.get(&hash).unwrap().is_none());
    }

    #[test]
    fn test_cache_stats() {
        let cache = temp_cache();
        let hash1 = LlmCache::compute_hash("gemini", "sys", "prompt1");
        let hash2 = LlmCache::compute_hash("gemini", "sys", "prompt2");

        cache.put(&hash1, "gemini", "sys", "prompt1", "r1").unwrap();
        cache.put(&hash2, "gemini", "sys", "prompt2", "r2").unwrap();

        let stats = cache.stats().unwrap();
        assert_eq!(stats.total, 2);
        assert_eq!(stats.valid, 2);
        assert_eq!(stats.expired, 0);
        assert!(stats.db_size_bytes > 0);
    }

    #[test]
    fn test_cache_prune_expired() {
        let cache = temp_cache();
        let hash = LlmCache::compute_hash("gemini", "sys", "prompt");
        cache
            .put(&hash, "gemini", "sys", "prompt", "response")
            .unwrap();

        // Manually expire by setting expires_at to past
        let db = cache.db.lock().unwrap();
        db.execute(
            "UPDATE llm_cache SET expires_at = '2000-01-01T00:00:00+00:00'",
            [],
        )
        .unwrap();
        drop(db);

        let pruned = cache.prune_expired().unwrap();
        assert_eq!(pruned, 1);

        let stats = cache.stats().unwrap();
        assert_eq!(stats.total, 0);
    }
}
