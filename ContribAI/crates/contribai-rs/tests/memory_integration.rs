//! Integration tests for the Memory (SQLite) layer.
//!
//! Tests the full CRUD lifecycle across all tables using in-memory SQLite.

use contribai::orchestrator::memory::{ConversationMessage, Memory};

/// Helper: create a fresh in-memory Memory instance.
fn mem() -> Memory {
    Memory::open_in_memory().expect("in-memory DB should open")
}

// ── Repo Analysis ─────────────────────────────────────────────────────────

#[test]
fn test_analysis_lifecycle() {
    let m = mem();

    // Not analyzed yet
    assert!(!m.has_analyzed("owner/repo").unwrap());

    // Record analysis
    m.record_analysis("owner/repo", "rust", 1500, 5).unwrap();
    assert!(m.has_analyzed("owner/repo").unwrap());

    // Different repo still unanalyzed
    assert!(!m.has_analyzed("other/repo").unwrap());
}

#[test]
fn test_analysis_upsert() {
    let m = mem();
    m.record_analysis("owner/repo", "rust", 1000, 3).unwrap();
    // Upsert with new data — should not error (INSERT OR REPLACE)
    m.record_analysis("owner/repo", "rust", 1200, 7).unwrap();
    assert!(m.has_analyzed("owner/repo").unwrap());
}

// ── PR Lifecycle ──────────────────────────────────────────────────────────

#[test]
fn test_pr_record_and_query() {
    let m = mem();

    m.record_pr(
        "owner/repo",
        42,
        "https://github.com/owner/repo/pull/42",
        "Fix unused import",
        "quality",
        "fix/unused-import",
        "contribai-bot/repo",
    )
    .unwrap();

    // Query all PRs
    let prs = m.get_prs(None, 10).unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0]["repo"], "owner/repo");
    assert_eq!(prs[0]["pr_number"], "42");

    // Query by status — default is 'open'
    let open = m.get_prs(Some("open"), 10).unwrap();
    assert_eq!(open.len(), 1);

    let merged = m.get_prs(Some("merged"), 10).unwrap();
    assert!(merged.is_empty());
}

#[test]
fn test_pr_status_update() {
    let m = mem();

    m.record_pr(
        "owner/repo",
        1,
        "https://example.com/pr/1",
        "Test PR",
        "refactor",
        "fix/test",
        "bot/repo",
    )
    .unwrap();

    m.update_pr_status("owner/repo", 1, "merged").unwrap();

    let merged = m.get_prs(Some("merged"), 10).unwrap();
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0]["status"], "merged");

    let open = m.get_prs(Some("open"), 10).unwrap();
    assert!(open.is_empty());
}

#[test]
fn test_daily_pr_count() {
    let m = mem();

    assert_eq!(m.get_today_pr_count().unwrap(), 0);

    m.record_pr("a/b", 1, "https://x.com/1", "PR 1", "quality", "b1", "f1")
        .unwrap();
    m.record_pr("c/d", 2, "https://x.com/2", "PR 2", "security", "b2", "f2")
        .unwrap();

    // Both created "today" (created_at uses Utc::now)
    assert_eq!(m.get_today_pr_count().unwrap(), 2);
}

// ── Run Log ───────────────────────────────────────────────────────────────

#[test]
fn test_run_log_lifecycle() {
    let m = mem();

    let run_id = m.start_run().unwrap();
    assert!(run_id > 0);

    m.finish_run(run_id, 5, 2, 10, 1).unwrap();

    let stats = m.get_stats().unwrap();
    assert_eq!(stats["total_runs"], 1);
}

// ── Stats ─────────────────────────────────────────────────────────────────

#[test]
fn test_stats_aggregation() {
    let m = mem();

    // Empty state
    let stats = m.get_stats().unwrap();
    assert_eq!(stats["total_repos_analyzed"], 0);
    assert_eq!(stats["total_prs_submitted"], 0);
    assert_eq!(stats["prs_merged"], 0);
    assert_eq!(stats["total_runs"], 0);

    // Add data
    m.record_analysis("a/b", "python", 500, 3).unwrap();
    m.record_analysis("c/d", "go", 1000, 1).unwrap();
    m.record_pr("a/b", 1, "url", "t", "quality", "b", "f")
        .unwrap();
    m.record_pr("a/b", 2, "url2", "t2", "security", "b2", "f2")
        .unwrap();
    m.update_pr_status("a/b", 1, "merged").unwrap();
    m.start_run().unwrap();

    let stats = m.get_stats().unwrap();
    assert_eq!(stats["total_repos_analyzed"], 2);
    assert_eq!(stats["total_prs_submitted"], 2);
    assert_eq!(stats["prs_merged"], 1);
    assert_eq!(stats["total_runs"], 1);
}

// ── Working Memory (Context) ──────────────────────────────────────────────

#[test]
fn test_working_memory_store_and_get() {
    let m = mem();

    m.store_context("owner/repo", "file_tree", "{files: [...]}", "rust", 72.0)
        .unwrap();

    let val = m.get_context("owner/repo", "file_tree").unwrap();
    assert!(val.is_some());
    assert!(val.unwrap().contains("files"));

    // Different key returns None
    let missing = m.get_context("owner/repo", "nonexistent").unwrap();
    assert!(missing.is_none());
}

#[test]
fn test_working_memory_upsert() {
    let m = mem();

    m.store_context("r", "k", "v1", "py", 1.0).unwrap();
    m.store_context("r", "k", "v2", "py", 1.0).unwrap();

    let val = m.get_context("r", "k").unwrap().unwrap();
    assert_eq!(val, "v2");
}

// ── Outcome Learning ──────────────────────────────────────────────────────

#[test]
fn test_outcome_and_preferences() {
    let m = mem();

    m.record_outcome("owner/repo", 1, "url1", "quality", "merged", "LGTM", 24.0)
        .unwrap();
    m.record_outcome(
        "owner/repo",
        2,
        "url2",
        "security",
        "closed",
        "Not needed",
        2.0,
    )
    .unwrap();

    let prefs = m.get_repo_preferences("owner/repo").unwrap();
    assert!(prefs.is_some());
    let prefs = prefs.unwrap();

    assert!(prefs.preferred_types.contains(&"quality".to_string()));
    assert!(prefs.rejected_types.contains(&"security".to_string()));
    assert!(prefs.merge_rate > 0.0 && prefs.merge_rate < 1.0); // 1/2 = 0.5
}

// ── Dream Consolidation ──────────────────────────────────────────────────

#[test]
fn test_dream_gates() {
    let m = mem();

    // Fresh DB: no sessions → should_dream = false (gate 2 fails)
    assert!(!m.should_dream().unwrap());
}

#[test]
fn test_dream_run_empty() {
    let m = mem();

    // Dream with no data should succeed with zero repos profiled
    let result = m.run_dream().unwrap();
    assert!(result.success);
    assert_eq!(result.repos_profiled, 0);
}

#[test]
fn test_dream_run_with_outcomes() {
    let m = mem();

    // Record outcomes for 2 repos
    m.record_outcome("a/b", 1, "u1", "quality", "merged", "", 10.0)
        .unwrap();
    m.record_outcome("a/b", 2, "u2", "docs", "closed", "No docs PRs please", 1.0)
        .unwrap();
    m.record_outcome("c/d", 3, "u3", "security", "merged", "Great catch", 48.0)
        .unwrap();

    let result = m.run_dream().unwrap();
    assert!(result.success);
    assert_eq!(result.repos_profiled, 2);
}

// ── Conversation Memory ──────────────────────────────────────────────────

#[test]
fn test_conversation_record_and_context() {
    let m = mem();

    m.record_conversation(&ConversationMessage {
        repo: "owner/repo".into(),
        pr_number: 42,
        role: "maintainer".into(),
        author: "alice".into(),
        body: "Please use unwrap_or_default()".into(),
        comment_id: 100,
        is_inline: true,
        file_path: Some("src/lib.rs".into()),
    })
    .unwrap();

    m.record_conversation(&ConversationMessage {
        repo: "owner/repo".into(),
        pr_number: 42,
        role: "contribai".into(),
        author: "contribai-bot".into(),
        body: "Fixed, pushed update".into(),
        comment_id: 101,
        is_inline: false,
        file_path: None,
    })
    .unwrap();

    let ctx = m.get_conversation_context("owner/repo", 42).unwrap();
    assert!(ctx.contains("[maintainer @alice"));
    assert!(ctx.contains("unwrap_or_default"));
    assert!(ctx.contains("[contribai @contribai-bot]"));
    assert!(ctx.contains("(on src/lib.rs)"));
}

#[test]
fn test_conversation_duplicate_ignored() {
    let m = mem();

    let msg = ConversationMessage {
        repo: "r".into(),
        pr_number: 1,
        role: "maintainer".into(),
        author: "bob".into(),
        body: "Looks good".into(),
        comment_id: 200,
        is_inline: false,
        file_path: None,
    };

    m.record_conversation(&msg).unwrap();
    // Same comment_id — should be silently ignored (INSERT OR IGNORE)
    m.record_conversation(&msg).unwrap();

    let count = m.get_conversation_count("r", 1).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_conversation_empty_pr() {
    let m = mem();

    let ctx = m.get_conversation_context("nonexistent/repo", 999).unwrap();
    assert!(ctx.is_empty());
}
