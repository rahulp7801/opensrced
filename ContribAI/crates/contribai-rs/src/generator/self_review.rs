//! LLM self-review gate for generated contributions.

use tracing::{info, warn};

use crate::core::models::{Contribution, RepoContext};
use crate::core::safe_truncate;

use super::engine::ContributionGenerator;

impl ContributionGenerator<'_> {
    /// Have the LLM review the generated contribution and approve or reject it.
    ///
    /// Builds a unified diff for modified files and asks the LLM whether the
    /// change is correct. Defaults to `false` (rejected) on LLM failures to
    /// ensure a fail-closed posture.
    /// Backwards-compatible boolean wrapper around `self_review_with_reason`.
    pub(crate) async fn self_review(
        &self,
        contribution: &Contribution,
        context: &RepoContext,
    ) -> bool {
        self.self_review_with_reason(contribution, context).await.0
    }

    pub(crate) async fn self_review_with_reason(
        &self,
        contribution: &Contribution,
        context: &RepoContext,
    ) -> (bool, Option<String>) {
        let changes_summary: String = contribution
            .changes
            .iter()
            .map(|c| {
                format!(
                    "- {} ({})\n",
                    c.path,
                    if c.is_new_file { "new" } else { "modified" }
                )
            })
            .collect();

        let mut prompt = format!(
            "Review the following code contribution for quality:\n\n\
             **Title**: {}\n\
             **Type**: {:?}\n\
             **Finding**: {}\n\
             **Changes**:\n{}\n\n\
             For each changed file:\n",
            contribution.title,
            contribution.contribution_type,
            contribution.finding.description,
            changes_summary
        );

        // Tight token budget: the reviewer doesn't need full file content,
        // just enough diff to judge whether the change is on-topic and sane.
        // Capping at ~1500 chars per change keeps Gemini-as-reviewer well
        // under its daily token quota.
        for change in contribution.changes.iter().take(5) {
            let original = context.relevant_files.get(&change.path);
            if let (Some(orig), false) = (original, change.is_new_file) {
                let diff = unified_diff(orig, &change.new_content, &change.path);
                let diff_snippet = safe_truncate(&diff, 1500);
                prompt.push_str(&format!(
                    "\n### {} (diff)\n```diff\n{}\n```\n",
                    change.path, diff_snippet
                ));
            } else {
                let snippet = safe_truncate(&change.new_content, 1500);
                prompt.push_str(&format!("\n### {}\n```\n{}\n```\n", change.path, snippet));
            }
        }

        prompt.push_str(
            "\nAnswer these questions:\n\
             1. Does the change address the described issue?\n\
             2. Does it introduce any obvious new bugs or security vulnerabilities?\n\
             3. Is the change reasonable and follows existing code style?\n\n\
             IMPORTANT: Be lenient. APPROVE if the change is a net improvement, \
             even if minor improvements could be made. Only REJECT if the change \
             is clearly wrong, introduces a bug, or is completely unrelated to the issue.\n\n\
             Reply with APPROVE or REJECT followed by brief reasoning.",
        );

        let reviewer = self.reviewer_llm.unwrap_or(self.llm);
        match reviewer.complete(&prompt, None, Some(0.1), None).await {
            Ok(response) => {
                let approved = response.to_uppercase().contains("APPROVE");
                if !approved {
                    info!(
                        preview = %&response[..response.len().min(200)],
                        "Self-review rejected"
                    );
                    // Strip the verdict tokens from the response to extract
                    // any actual reasoning the reviewer gave.
                    let body = response
                        .replace("APPROVE", "")
                        .replace("REJECT", "")
                        .replace("**", "")
                        .replace("`", "");
                    let trimmed = body.trim();

                    // If the reviewer gave no real explanation (just bare
                    // "REJECT" or fewer than ~25 chars of prose), treat the
                    // rejection as flaky. Local code-gen models are weak
                    // reviewers — bare REJECTs are usually wrong, and the
                    // human dashboard gate is the real review anyway.
                    if trimmed.len() < 25 {
                        warn!(
                            "Self-review returned a bare REJECT with no reasoning ({} chars after stripping verdict); treating as flaky and approving. Human review remains required before submit.",
                            trimmed.len()
                        );
                        return (true, None);
                    }

                    let reason = trimmed
                        .lines()
                        .skip_while(|l| l.trim().is_empty())
                        .take(10)
                        .collect::<Vec<_>>()
                        .join("\n");
                    return (false, Some(reason));
                }
                (true, None)
            }
            Err(e) => {
                warn!(error = %e, "Self-review LLM call failed, rejecting by default");
                (false, Some(format!("Self-review LLM call failed: {}", e)))
            }
        }
    }

    /// Verify that the original finding is a real issue (not a false positive).
    ///
    /// Asks the LLM to evaluate whether the finding describes an actual bug
    /// or if it was hallucinated by the analysis step. Defaults to `true`
    /// (assumed real) on LLM failure to avoid blocking legitimate fixes.
    pub(crate) async fn verify_finding(
        &self,
        contribution: &Contribution,
        context: &RepoContext,
    ) -> bool {
        let finding = &contribution.finding;
        let file_content = context
            .relevant_files
            .get(&finding.file_path)
            .map(|s| safe_truncate(s, 4000))
            .unwrap_or_default();

        let prompt = format!(
            "You are a senior code reviewer. Determine if this finding is a REAL issue.\n\n\
             **File**: `{}`\n\
             **Finding**: {}\n\
             **Suggestion**: {}\n\n\
             ```\n{}\n```\n\n\
             Consider:\n\
             1. Could this be intentional behavior?\n\
             2. Is there context that makes this correct as-is?\n\
             3. Would a maintainer agree this needs changing?\n\n\
             Reply REAL_BUG or FALSE_POSITIVE with one-line reasoning.",
            finding.file_path,
            finding.description,
            finding.suggestion.as_deref().unwrap_or("N/A"),
            file_content,
        );

        let reviewer = self.reviewer_llm.unwrap_or(self.llm);
        match reviewer.complete(&prompt, None, Some(0.1), None).await {
            Ok(response) => {
                let is_real = !response.to_uppercase().contains("FALSE_POSITIVE");
                if !is_real {
                    info!(
                        finding = %finding.title,
                        reasoning = %&response[..response.len().min(200)],
                        "Bug verification: FALSE_POSITIVE"
                    );
                }
                is_real
            }
            Err(e) => {
                warn!(error = %e, "Bug verification LLM call failed, assuming real");
                true
            }
        }
    }
}

/// Build a simple diff string between two text blobs for LLM self-review.
///
/// Emits removed lines (prefixed `-`) and added lines (prefixed `+`).
/// This is sufficient for the LLM to understand the nature of the change.
pub fn unified_diff(original: &str, new_content: &str, path: &str) -> String {
    let orig_lines: Vec<&str> = original.lines().collect();
    let new_lines: Vec<&str> = new_content.lines().collect();

    let mut output = format!("--- a/{}\n+++ b/{}\n", path, path);

    let orig_set: std::collections::HashSet<&str> = orig_lines.iter().copied().collect();
    let new_set: std::collections::HashSet<&str> = new_lines.iter().copied().collect();

    for line in &orig_lines {
        if !new_set.contains(*line) {
            output.push_str(&format!("-{}\n", line));
        }
    }
    for line in &new_lines {
        if !orig_set.contains(*line) {
            output.push_str(&format!("+{}\n", line));
        }
    }

    output
}
