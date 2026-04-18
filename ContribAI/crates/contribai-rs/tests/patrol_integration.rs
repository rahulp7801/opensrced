//! Integration tests for PR Patrol.
//!
//! Tests the patrol feedback collection → classification → response flow
//! with mock GitHub API (wiremock) and mock LLM.

mod common;

use common::mock_github;
use common::mock_llm::MockLlm;
use contribai::github::client::GitHubClient;
use contribai::orchestrator::memory::Memory;
use contribai::pr::patrol::PrPatrol;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Build a GitHubClient pointed at the mock server.
fn mock_github_client(server_url: &str) -> GitHubClient {
    GitHubClient::new("fake-token", 100)
        .expect("client build")
        .with_base_url(server_url)
}

/// Helper: create a PR record as stored in memory (what patrol() receives).
fn pr_record(repo: &str, pr_number: u64) -> serde_json::Value {
    json!({
        "repo": repo,
        "pr_number": pr_number,
        "status": "open",
        "url": format!("https://github.com/{}/pull/{}", repo, pr_number),
        "title": "Test PR"
    })
}

/// Helper: mock the GET /repos/{owner}/{name}/pulls/{number} endpoint (PR details).
async fn mock_pr_details_open(server: &MockServer, owner: &str, name: &str, pr_number: u64) {
    let pr = json!({
        "number": pr_number,
        "state": "open",
        "title": "Test PR",
        "user": { "login": "test-bot", "type": "User" },
        "body": "A test PR",
        "html_url": format!("https://github.com/{}/{}/pull/{}", owner, name, pr_number),
        "head": { "ref": "fix-branch", "sha": "abc123" },
        "base": { "ref": "main" }
    });
    Mock::given(method("GET"))
        .and(path(format!(
            "/repos/{}/{}/pulls/{}",
            owner, name, pr_number
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(pr))
        .mount(server)
        .await;
}

// ── Test: Bot feedback is filtered out ───────────────────────────

#[tokio::test]
async fn test_patrol_filters_bot_feedback() {
    let server = MockServer::start().await;
    let llm = MockLlm::new();
    let memory = Memory::open_in_memory().expect("memory");
    let github = mock_github_client(&server.uri());

    // Mock authenticated user
    mock_github::mock_authenticated_user(&server).await;

    // Mock PR details (open)
    mock_pr_details_open(&server, "owner", "repo", 1).await;

    // Mock issue comments: only a bot comment (dependabot)
    mock_github::mock_issue_comments(
        &server,
        "owner",
        "repo",
        1,
        vec![json!({
            "id": 100,
            "user": { "login": "dependabot[bot]", "type": "Bot" },
            "body": "Bump version of foo",
            "created_at": "2026-04-01T00:00:00Z"
        })],
    )
    .await;

    // Mock review comments: bot from REVIEW_BOT_LOGINS
    mock_github::mock_pr_comments(
        &server,
        "owner",
        "repo",
        1,
        vec![json!({
            "id": 200,
            "user": { "login": "coderabbitai", "type": "User" },
            "body": "AI review: looks good",
            "path": "src/lib.rs",
            "line": 10,
            "diff_hunk": "@@ -1,3 +1,4 @@"
        })],
    )
    .await;

    let records = vec![pr_record("owner/repo", 1)];
    let mut patrol = PrPatrol::new(&github, &llm).with_memory(&memory);
    let result = patrol.patrol(&records, true).await.expect("patrol");

    // Bot feedback filtered → LLM never called for classification
    assert_eq!(
        llm.calls(),
        0,
        "LLM should not be called for bot-only feedback"
    );
    assert_eq!(result.prs_checked, 1);
}

// ── Test: Real user feedback gets classified via LLM ─────────────

#[tokio::test]
async fn test_patrol_classifies_real_feedback() {
    let server = MockServer::start().await;
    let llm = MockLlm::new();
    let memory = Memory::open_in_memory().expect("memory");
    let github = mock_github_client(&server.uri());

    mock_github::mock_authenticated_user(&server).await;
    mock_pr_details_open(&server, "owner", "repo", 1).await;

    // Real user comment
    mock_github::mock_issue_comments(
        &server,
        "owner",
        "repo",
        1,
        vec![json!({
            "id": 300,
            "user": { "login": "maintainer-alice", "type": "User" },
            "body": "Please fix the import order in this file",
            "created_at": "2026-04-02T10:00:00Z"
        })],
    )
    .await;

    // No inline review comments
    mock_github::mock_pr_comments(&server, "owner", "repo", 1, vec![]).await;

    let records = vec![pr_record("owner/repo", 1)];
    let mut patrol = PrPatrol::new(&github, &llm).with_memory(&memory);
    let result = patrol.patrol(&records, true).await.expect("patrol");

    // LLM should be called at least once for classification
    assert!(llm.calls() >= 1, "LLM should classify real user feedback");
    assert_eq!(result.prs_checked, 1);
}

// ── Test: Conversation context injected into classification ──────

#[tokio::test]
async fn test_patrol_injects_conversation_context() {
    let server = MockServer::start().await;
    let llm = MockLlm::new();
    let memory = Memory::open_in_memory().expect("memory");
    let github = mock_github_client(&server.uri());

    // Pre-populate conversation history
    memory
        .record_conversation(&contribai::orchestrator::memory::ConversationMessage {
            repo: "owner/repo".into(),
            pr_number: 1,
            role: "maintainer".into(),
            author: "maintainer-alice".into(),
            body: "The import order should follow PEP8".into(),
            comment_id: 50,
            is_inline: false,
            file_path: None,
        })
        .expect("record conv");

    mock_github::mock_authenticated_user(&server).await;
    mock_pr_details_open(&server, "owner", "repo", 1).await;

    // New feedback on same PR
    mock_github::mock_issue_comments(
        &server,
        "owner",
        "repo",
        1,
        vec![json!({
            "id": 301,
            "user": { "login": "maintainer-alice", "type": "User" },
            "body": "Still not fixed, please sort imports alphabetically",
            "created_at": "2026-04-03T10:00:00Z"
        })],
    )
    .await;

    mock_github::mock_pr_comments(&server, "owner", "repo", 1, vec![]).await;

    let records = vec![pr_record("owner/repo", 1)];
    let mut patrol = PrPatrol::new(&github, &llm).with_memory(&memory);
    let result = patrol.patrol(&records, true).await.expect("patrol");

    // Classification was called (conversation context is injected internally)
    assert!(
        llm.calls() >= 1,
        "LLM should be called with conversation context"
    );
    assert_eq!(result.prs_checked, 1);
}

// ── Test: 404 PR triggers auto-clean marker ──────────────────────

#[tokio::test]
async fn test_patrol_404_pr_marks_not_found() {
    let server = MockServer::start().await;
    let llm = MockLlm::new();
    let memory = Memory::open_in_memory().expect("memory");
    let github = mock_github_client(&server.uri());

    mock_github::mock_authenticated_user(&server).await;

    // PR details returns 404
    Mock::given(method("GET"))
        .and(path("/repos/owner/repo/pulls/99"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({"message": "Not Found"})))
        .mount(&server)
        .await;

    let records = vec![pr_record("owner/repo", 99)];
    let mut patrol = PrPatrol::new(&github, &llm).with_memory(&memory);
    let result = patrol.patrol(&records, false).await.expect("patrol");

    // Should have NOT_FOUND error marker for caller to clean up
    assert!(
        result.errors.iter().any(|e| e.contains("NOT_FOUND")),
        "Should contain NOT_FOUND marker, got: {:?}",
        result.errors
    );
    assert_eq!(llm.calls(), 0, "LLM should not be called for 404 PRs");
}

// ── Test: Dry-run skips posting actions ──────────────────────────

#[tokio::test]
async fn test_patrol_dry_run_skips_posting() {
    let server = MockServer::start().await;
    let llm = MockLlm::new();
    let memory = Memory::open_in_memory().expect("memory");
    let github = mock_github_client(&server.uri());

    mock_github::mock_authenticated_user(&server).await;
    mock_pr_details_open(&server, "owner", "repo", 1).await;

    // Actionable feedback
    mock_github::mock_issue_comments(
        &server,
        "owner",
        "repo",
        1,
        vec![json!({
            "id": 400,
            "user": { "login": "real-maintainer", "type": "User" },
            "body": "Please add error handling here",
            "created_at": "2026-04-02T10:00:00Z"
        })],
    )
    .await;

    mock_github::mock_pr_comments(&server, "owner", "repo", 1, vec![]).await;

    let records = vec![pr_record("owner/repo", 1)];
    let mut patrol = PrPatrol::new(&github, &llm).with_memory(&memory);
    let result = patrol.patrol(&records, true).await.expect("patrol");

    // Dry-run: no fixes pushed, no replies sent
    assert_eq!(result.fixes_pushed, 0, "dry-run should not push fixes");
    assert_eq!(result.replies_sent, 0, "dry-run should not send replies");
    assert_eq!(result.prs_checked, 1);
}
