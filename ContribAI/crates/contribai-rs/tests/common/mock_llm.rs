//! Mock LLM provider for integration tests.
//!
//! Returns canned responses based on prompt keywords.
//! Tracks call count for assertions.

#![allow(dead_code)] // Test utilities — may not all be used in current test suite

use async_trait::async_trait;
use contribai::llm::provider::{ChatMessage, LlmProvider};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Mock LLM that returns canned responses based on prompt content.
pub struct MockLlm {
    pub call_count: AtomicUsize,
}

impl MockLlm {
    pub fn new() -> Self {
        Self {
            call_count: AtomicUsize::new(0),
        }
    }

    pub fn calls(&self) -> usize {
        self.call_count.load(Ordering::Relaxed)
    }

    /// Route response based on prompt keywords.
    fn route_response(&self, prompt: &str) -> String {
        self.call_count.fetch_add(1, Ordering::Relaxed);

        if prompt.contains("analyze") || prompt.contains("finding") {
            // Analysis response — return a JSON findings array
            r#"[{"type":"quality","severity":"medium","title":"Unused import","file_path":"src/lib.rs","line":3,"description":"Remove unused import","suggestion":"Delete line 3"}]"#.into()
        } else if prompt.contains("generate") || prompt.contains("fix") || prompt.contains("code") {
            // Code generation response
            "// Fixed: removed unused import\nuse std::collections::HashMap;\n".into()
        } else if prompt.contains("review") || prompt.contains("self-review") {
            // Self-review response — approve
            r#"{"approved": true, "score": 0.85, "issues": []}"#.into()
        } else if prompt.contains("classify") || prompt.contains("feedback") {
            // Patrol classification response
            r#"{"action":"fix","summary":"Maintainer requests change"}"#.into()
        } else if prompt.contains("score") || prompt.contains("quality") {
            "8.5".into()
        } else {
            // Default response
            "OK".into()
        }
    }
}

#[async_trait]
impl LlmProvider for MockLlm {
    async fn complete(
        &self,
        prompt: &str,
        _system: Option<&str>,
        _temperature: Option<f64>,
        _max_tokens: Option<u32>,
    ) -> contribai::core::error::Result<String> {
        Ok(self.route_response(prompt))
    }

    async fn chat(
        &self,
        messages: &[ChatMessage],
        _system: Option<&str>,
        _temperature: Option<f64>,
        _max_tokens: Option<u32>,
    ) -> contribai::core::error::Result<String> {
        // Use last user message for routing
        let last = messages
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .map(|m| m.content.as_str())
            .unwrap_or("");
        Ok(self.route_response(last))
    }
}
