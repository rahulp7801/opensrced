//! Mock GitHub API helpers for integration tests.
//!
//! Uses wiremock to register canned responses for GitHub REST API endpoints.
//! All helpers take a `&MockServer` and register matchers.

#![allow(dead_code)] // Test utilities — may not all be used in current test suite

use serde_json::{json, Value};
use wiremock::matchers::{method, path, path_regex, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── Fixture Factories ─────────────────────────────────────────────

/// Create a fake repository JSON matching GitHub API shape.
pub fn fake_repo(owner: &str, name: &str, stars: i64) -> Value {
    json!({
        "id": 12345,
        "name": name,
        "full_name": format!("{}/{}", owner, name),
        "owner": { "login": owner },
        "description": format!("Test repo {}/{}", owner, name),
        "language": "Python",
        "stargazers_count": stars,
        "forks_count": 10,
        "open_issues_count": 5,
        "topics": ["test"],
        "default_branch": "main",
        "archived": false,
        "html_url": format!("https://github.com/{}/{}", owner, name),
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2026-04-01T00:00:00Z",
        "pushed_at": "2026-04-01T00:00:00Z"
    })
}

/// Create a fake pull request JSON.
pub fn fake_pr(number: u64, state: &str, title: &str) -> Value {
    let merged_at = if state == "closed" {
        json!("2026-04-01T12:00:00Z")
    } else {
        json!(null)
    };
    json!({
        "number": number,
        "state": state,
        "title": title,
        "user": { "login": "test-user", "type": "User" },
        "body": format!("PR body for {}", title),
        "html_url": format!("https://github.com/test/repo/pull/{}", number),
        "created_at": "2026-04-01T00:00:00Z",
        "updated_at": "2026-04-01T12:00:00Z",
        "merged_at": merged_at
    })
}

/// Create a fake PR without merged_at (closed but not merged).
pub fn fake_pr_unmerged(number: u64, title: &str) -> Value {
    json!({
        "number": number,
        "state": "closed",
        "title": title,
        "user": { "login": "test-user", "type": "User" },
        "body": format!("PR body for {}", title),
        "html_url": format!("https://github.com/test/repo/pull/{}", number),
        "created_at": "2026-04-01T00:00:00Z",
        "updated_at": "2026-04-01T12:00:00Z",
        "merged_at": null
    })
}

/// Create a fake PR review JSON.
pub fn fake_review(user: &str, state: &str, body: &str) -> Value {
    json!({
        "id": 1001,
        "user": { "login": user, "type": "User" },
        "state": state,
        "body": body,
        "submitted_at": "2026-04-02T10:00:00Z",
        "html_url": "https://github.com/test/repo/pull/1#pullrequestreview-1001"
    })
}

/// Create a fake review comment JSON.
pub fn fake_review_comment(user: &str, body: &str) -> Value {
    json!({
        "id": 2001,
        "user": { "login": user, "type": "User" },
        "body": body,
        "created_at": "2026-04-02T10:00:00Z",
        "updated_at": "2026-04-02T10:00:00Z",
        "html_url": "https://github.com/test/repo/pull/1#discussion_r2001"
    })
}

// ── Wiremock Registration Helpers ─────────────────────────────────

/// Mock GET /repos/{owner}/{name} → repo details.
pub async fn mock_repo_details(server: &MockServer, owner: &str, name: &str, stars: i64) {
    Mock::given(method("GET"))
        .and(path(format!("/repos/{}/{}", owner, name)))
        .respond_with(ResponseTemplate::new(200).set_body_json(fake_repo(owner, name, stars)))
        .mount(server)
        .await;
}

/// Mock GET /repos/{owner}/{name}/git/trees/main?recursive=1 → file tree.
pub async fn mock_file_tree(server: &MockServer, owner: &str, name: &str) {
    let tree = json!({
        "sha": "abc123",
        "tree": [
            { "path": "src/lib.rs", "type": "blob", "size": 500 },
            { "path": "src/main.rs", "type": "blob", "size": 200 },
            { "path": "README.md", "type": "blob", "size": 1000 }
        ],
        "truncated": false
    });
    Mock::given(method("GET"))
        .and(path_regex(format!(
            r"/repos/{}/{}/git/trees/.*",
            owner, name
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(tree))
        .mount(server)
        .await;
}

/// Mock GET /repos/{owner}/{name}/pulls?state={state} → PR list.
pub async fn mock_pull_requests(
    server: &MockServer,
    owner: &str,
    name: &str,
    state: &str,
    prs: Vec<Value>,
) {
    Mock::given(method("GET"))
        .and(path(format!("/repos/{}/{}/pulls", owner, name)))
        .and(query_param("state", state))
        .respond_with(ResponseTemplate::new(200).set_body_json(prs))
        .mount(server)
        .await;
}

/// Mock GET /repos/{owner}/{name}/pulls/{pr_number}/reviews → review list.
pub async fn mock_pr_reviews(
    server: &MockServer,
    owner: &str,
    name: &str,
    pr_number: u64,
    reviews: Vec<Value>,
) {
    Mock::given(method("GET"))
        .and(path(format!(
            "/repos/{}/{}/pulls/{}/reviews",
            owner, name, pr_number
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(reviews))
        .mount(server)
        .await;
}

/// Mock GET /repos/{owner}/{name}/pulls/{pr_number}/comments → comment list.
pub async fn mock_pr_comments(
    server: &MockServer,
    owner: &str,
    name: &str,
    pr_number: u64,
    comments: Vec<Value>,
) {
    Mock::given(method("GET"))
        .and(path(format!(
            "/repos/{}/{}/pulls/{}/comments",
            owner, name, pr_number
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(comments))
        .mount(server)
        .await;
}

/// Mock GET /repos/{owner}/{name}/issues/{pr_number}/comments → issue comment list.
pub async fn mock_issue_comments(
    server: &MockServer,
    owner: &str,
    name: &str,
    pr_number: u64,
    comments: Vec<Value>,
) {
    Mock::given(method("GET"))
        .and(path(format!(
            "/repos/{}/{}/issues/{}/comments",
            owner, name, pr_number
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(comments))
        .mount(server)
        .await;
}

/// Mock GET /user → authenticated user.
pub async fn mock_authenticated_user(server: &MockServer) {
    let user = json!({
        "login": "test-bot",
        "id": 99999,
        "type": "User",
        "name": "Test Bot",
        "email": "test-bot@example.com"
    });
    Mock::given(method("GET"))
        .and(path("/user"))
        .respond_with(ResponseTemplate::new(200).set_body_json(user))
        .mount(server)
        .await;
}

/// Mock GET /search/repositories → search results.
pub async fn mock_search_repos(server: &MockServer, repos: Vec<Value>) {
    let result = json!({
        "total_count": repos.len(),
        "incomplete_results": false,
        "items": repos
    });
    Mock::given(method("GET"))
        .and(path("/search/repositories"))
        .respond_with(ResponseTemplate::new(200).set_body_json(result))
        .mount(server)
        .await;
}

/// Mock a 404 response for PR reviews (for auto-clean tests).
pub async fn mock_pr_reviews_404(server: &MockServer, owner: &str, name: &str, pr_number: u64) {
    Mock::given(method("GET"))
        .and(path(format!(
            "/repos/{}/{}/pulls/{}/reviews",
            owner, name, pr_number
        )))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({"message": "Not Found"})))
        .mount(server)
        .await;
}
