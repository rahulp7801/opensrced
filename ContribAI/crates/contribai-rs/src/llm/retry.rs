//! LLM retry wrapper with exponential backoff.
//!
//! Wraps any `Box<dyn LlmProvider>` to add automatic retry on transient failures
//! (rate limits, 5xx errors, network timeouts). Uses exponential backoff
//! with jitter to avoid thundering herd problems.

use async_trait::async_trait;
use tracing::{info, warn};

use crate::core::error::{ContribError, Result};

use super::provider::{ChatMessage, LlmProvider};

/// Default configuration for retry behavior.
const DEFAULT_MAX_RETRIES: u32 = 3;
const DEFAULT_BASE_DELAY_MS: u64 = 1000;
const DEFAULT_MAX_DELAY_MS: u64 = 30_000;

/// Wraps a `Box<dyn LlmProvider>` with automatic retry on transient failures.
///
/// Retries on:
/// - Rate limit errors (429 / "rate limit" in message)
/// - Server errors (5xx / "server error" in message)
/// - Network/timeout errors ("HTTP error" / "timeout" in message)
///
/// Does NOT retry on:
/// - Auth errors (missing/invalid API key)
/// - Invalid request errors (bad prompt format)
/// - Successful but empty responses
pub struct RetryingProvider {
    inner: Box<dyn LlmProvider>,
    max_retries: u32,
    base_delay_ms: u64,
    max_delay_ms: u64,
}

impl RetryingProvider {
    /// Create a new retrying wrapper with default settings.
    pub fn new(inner: Box<dyn LlmProvider>) -> Self {
        Self {
            inner,
            max_retries: DEFAULT_MAX_RETRIES,
            base_delay_ms: DEFAULT_BASE_DELAY_MS,
            max_delay_ms: DEFAULT_MAX_DELAY_MS,
        }
    }

    /// Create with custom retry parameters.
    pub fn with_config(inner: Box<dyn LlmProvider>, max_retries: u32, base_delay_ms: u64) -> Self {
        Self {
            inner,
            max_retries,
            base_delay_ms,
            max_delay_ms: DEFAULT_MAX_DELAY_MS,
        }
    }

    /// Check if an error is retryable.
    pub fn is_retryable(err: &ContribError) -> bool {
        let msg = format!("{}", err).to_lowercase();
        msg.contains("rate limit")
            || msg.contains("429")
            || msg.contains("500")
            || msg.contains("502")
            || msg.contains("503")
            || msg.contains("server error")
            || msg.contains("http error")
            || msg.contains("timeout")
            || msg.contains("connection")
            || msg.contains("temporarily unavailable")
    }

    /// Calculate delay with exponential backoff + jitter.
    fn delay_ms(&self, attempt: u32) -> u64 {
        let base = self.base_delay_ms.saturating_mul(2u64.pow(attempt));
        // Simple jitter: ±25%
        let jitter_range = base / 4;
        let jitter = if jitter_range > 0 {
            // Deterministic-ish jitter based on attempt number
            (attempt as u64 * 137) % (jitter_range * 2)
        } else {
            0
        };
        (base + jitter).min(self.max_delay_ms)
    }
}

#[async_trait]
impl LlmProvider for RetryingProvider {
    async fn complete(
        &self,
        prompt: &str,
        system: Option<&str>,
        temperature: Option<f64>,
        max_tokens: Option<u32>,
    ) -> Result<String> {
        let mut last_error = None;

        for attempt in 0..=self.max_retries {
            match self
                .inner
                .complete(prompt, system, temperature, max_tokens)
                .await
            {
                Ok(result) => {
                    if attempt > 0 {
                        info!(attempt = attempt + 1, "✅ LLM call succeeded after retry");
                    }
                    return Ok(result);
                }
                Err(e) => {
                    if attempt < self.max_retries && Self::is_retryable(&e) {
                        let delay = self.delay_ms(attempt);
                        warn!(
                            attempt = attempt + 1,
                            max = self.max_retries + 1,
                            delay_ms = delay,
                            error = %e,
                            "⏳ LLM call failed, retrying"
                        );
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                        last_error = Some(e);
                    } else {
                        return Err(e);
                    }
                }
            }
        }

        Err(last_error
            .unwrap_or_else(|| ContribError::Llm("All retry attempts exhausted".to_string())))
    }

    async fn chat(
        &self,
        messages: &[ChatMessage],
        system: Option<&str>,
        temperature: Option<f64>,
        max_tokens: Option<u32>,
    ) -> Result<String> {
        let mut last_error = None;

        for attempt in 0..=self.max_retries {
            match self
                .inner
                .chat(messages, system, temperature, max_tokens)
                .await
            {
                Ok(result) => {
                    if attempt > 0 {
                        info!(attempt = attempt + 1, "✅ LLM chat succeeded after retry");
                    }
                    return Ok(result);
                }
                Err(e) => {
                    if attempt < self.max_retries && Self::is_retryable(&e) {
                        let delay = self.delay_ms(attempt);
                        warn!(
                            attempt = attempt + 1,
                            max = self.max_retries + 1,
                            delay_ms = delay,
                            error = %e,
                            "⏳ LLM chat failed, retrying"
                        );
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                        last_error = Some(e);
                    } else {
                        return Err(e);
                    }
                }
            }
        }

        Err(last_error
            .unwrap_or_else(|| ContribError::Llm("All retry attempts exhausted".to_string())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    /// Mock provider that fails N times then succeeds.
    struct FailingProvider {
        fail_count: Arc<AtomicU32>,
        max_fails: u32,
        error_msg: String,
    }

    impl FailingProvider {
        fn new(max_fails: u32, error_msg: &str) -> Self {
            Self {
                fail_count: Arc::new(AtomicU32::new(0)),
                max_fails,
                error_msg: error_msg.to_string(),
            }
        }
    }

    #[async_trait]
    impl LlmProvider for FailingProvider {
        async fn complete(
            &self,
            _prompt: &str,
            _system: Option<&str>,
            _temperature: Option<f64>,
            _max_tokens: Option<u32>,
        ) -> Result<String> {
            let count = self.fail_count.fetch_add(1, Ordering::SeqCst);
            if count < self.max_fails {
                Err(ContribError::Llm(self.error_msg.clone()))
            } else {
                Ok("success".to_string())
            }
        }

        async fn chat(
            &self,
            _messages: &[ChatMessage],
            _system: Option<&str>,
            _temperature: Option<f64>,
            _max_tokens: Option<u32>,
        ) -> Result<String> {
            self.complete("", None, None, None).await
        }
    }

    #[tokio::test]
    async fn test_retry_succeeds_after_transient_failure() {
        let provider = FailingProvider::new(2, "rate limit exceeded (429)");
        let count = provider.fail_count.clone();
        let retrying = RetryingProvider::with_config(Box::new(provider), 3, 10);

        let result = retrying.complete("test", None, None, None).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "success");
        // 2 failures + 1 success = 3 total calls
        assert_eq!(count.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn test_retry_exhausted() {
        let provider = FailingProvider::new(10, "server error 500");
        let count = provider.fail_count.clone();
        let retrying = RetryingProvider::with_config(Box::new(provider), 2, 10);

        let result = retrying.complete("test", None, None, None).await;
        assert!(result.is_err());
        // 3 total attempts (1 initial + 2 retries)
        assert_eq!(count.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn test_no_retry_on_auth_error() {
        let provider = FailingProvider::new(5, "GEMINI_API_KEY not set");
        let count = provider.fail_count.clone();
        let retrying = RetryingProvider::with_config(Box::new(provider), 3, 10);

        let result = retrying.complete("test", None, None, None).await;
        assert!(result.is_err());
        // Only 1 attempt — auth errors are not retryable
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_immediate_success_no_retry() {
        let provider = FailingProvider::new(0, "won't happen");
        let count = provider.fail_count.clone();
        let retrying = RetryingProvider::new(Box::new(provider));

        let result = retrying.complete("test", None, None, None).await;
        assert!(result.is_ok());
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_is_retryable() {
        assert!(RetryingProvider::is_retryable(&ContribError::Llm(
            "rate limit exceeded".to_string()
        )));
        assert!(RetryingProvider::is_retryable(&ContribError::Llm(
            "server error 500".to_string()
        )));
        assert!(RetryingProvider::is_retryable(&ContribError::Llm(
            "Gemini HTTP error: timeout".to_string()
        )));
        assert!(!RetryingProvider::is_retryable(&ContribError::Llm(
            "GEMINI_API_KEY not set".to_string()
        )));
        assert!(!RetryingProvider::is_retryable(&ContribError::Llm(
            "Unknown LLM provider".to_string()
        )));
    }

    #[test]
    fn test_delay_exponential() {
        let provider = FailingProvider::new(0, "");
        let r = RetryingProvider::with_config(Box::new(provider), 3, 1000);
        let d0 = r.delay_ms(0);
        let d1 = r.delay_ms(1);
        let d2 = r.delay_ms(2);
        // Exponential: base grows 1000, 2000, 4000
        assert!(d0 >= 1000 && d0 <= 1500, "d0={}", d0);
        assert!(d1 >= 2000 && d1 <= 3000, "d1={}", d1);
        assert!(d2 >= 4000 && d2 <= 6000, "d2={}", d2);
    }
}
