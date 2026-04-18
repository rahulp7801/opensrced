//! Integration tests for Hunt mode.
//!
//! Tests the hunt pre-processing logic: daily limit gate, merge-friendly
//! filtering, TTL skip, and discovery flow — all with mock GitHub + LLM.

mod common;

use common::mock_github::{self, fake_repo};
use common::mock_llm::MockLlm;
use contribai::core::config::ContribAIConfig;
use contribai::core::events::EventBus;
use contribai::github::client::GitHubClient;
use contribai::orchestrator::memory::Memory;
use contribai::orchestrator::pipeline::ContribPipeline;

/// Build test infrastructure for hunt tests.
struct HuntTestHarness {
    pub config: ContribAIConfig,
    pub memory: Memory,
    pub llm: MockLlm,
    pub event_bus: EventBus,
}

impl HuntTestHarness {
    fn new() -> Self {
        let mut config = ContribAIConfig::default();
        // Minimal config for hunt: 1 language, small star range
        config.discovery.languages = vec!["python".into()];
        config.discovery.stars_min = 100;
        config.discovery.stars_max = 5000;
        config.discovery.max_results = 5;
        config.github.max_prs_per_day = 5;
        config.pipeline.max_repos_per_run = 2;
        Self {
            config,
            memory: Memory::open_in_memory().expect("memory"),
            llm: MockLlm::new(),
            event_bus: EventBus::new(100),
        }
    }

    fn github_client(&self, server_url: &str) -> GitHubClient {
        GitHubClient::new("fake-token", 100)
            .expect("client")
            .with_base_url(server_url)
    }
}

// ── Test: Daily limit stops hunt immediately ─────────────────────

#[tokio::test]
async fn test_hunt_stops_at_daily_limit() {
    let server = wiremock::MockServer::start().await;
    let harness = HuntTestHarness::new();
    let github = harness.github_client(&server.uri());

    // Pre-populate memory with max_prs_per_day PRs for today
    for i in 1..=5 {
        harness
            .memory
            .record_pr(
                &format!("owner/repo-{}", i),
                i as i64,
                &format!("https://github.com/owner/repo-{}/pull/{}", i, i),
                &format!("PR #{}", i),
                "quality",
                "fix/test",
                "fork/repo",
            )
            .expect("record pr");
    }

    let pipeline = ContribPipeline::new(
        &harness.config,
        &github,
        &harness.llm,
        &harness.memory,
        &harness.event_bus,
    );

    // dry_run=false so the daily limit check fires
    let result = pipeline.hunt(3, 0, false, "normal").await.expect("hunt");

    // Hunt should stop immediately — no repos analyzed
    assert_eq!(
        result.repos_analyzed, 0,
        "Should not analyze any repos when at daily limit"
    );
    assert_eq!(result.prs_created, 0);
}

// ── Test: Merge-friendly filter skips repos with 0 merged PRs ───

#[tokio::test]
async fn test_hunt_skips_repos_without_merged_prs() {
    let server = wiremock::MockServer::start().await;
    let harness = HuntTestHarness::new();
    let github = harness.github_client(&server.uri());

    // Mock search returning 2 repos
    mock_github::mock_search_repos(
        &server,
        vec![
            fake_repo("owner-a", "no-merges", 500),
            fake_repo("owner-b", "also-no-merges", 800),
        ],
    )
    .await;

    // Mock PR lists: all closed but none merged (merged_at = null)
    mock_github::mock_pull_requests(
        &server,
        "owner-a",
        "no-merges",
        "closed",
        vec![
            common::mock_github::fake_pr_unmerged(1, "Old PR 1"),
            common::mock_github::fake_pr_unmerged(2, "Old PR 2"),
        ],
    )
    .await;

    mock_github::mock_pull_requests(
        &server,
        "owner-b",
        "also-no-merges",
        "closed",
        vec![common::mock_github::fake_pr_unmerged(3, "Old PR 3")],
    )
    .await;

    let pipeline = ContribPipeline::new(
        &harness.config,
        &github,
        &harness.llm,
        &harness.memory,
        &harness.event_bus,
    );

    // Hunt with 1 round, dry_run=true (safe), delay=0
    let result = pipeline.hunt(1, 0, true, "normal").await.expect("hunt");

    // No merge-friendly repos → no repos analyzed
    assert_eq!(
        result.repos_analyzed, 0,
        "Should skip repos with 0 merged PRs"
    );
}

// ── Test: Recently analyzed repos skipped via 7-day TTL ──────────

#[tokio::test]
async fn test_hunt_skips_recently_analyzed_repos() {
    let server = wiremock::MockServer::start().await;
    let harness = HuntTestHarness::new();
    let github = harness.github_client(&server.uri());

    // Pre-record the repo as analyzed today
    harness
        .memory
        .record_analysis("owner-a/ttl-test", "python", 1000, 3)
        .expect("record analysis");

    // Mock search returning that repo
    mock_github::mock_search_repos(&server, vec![fake_repo("owner-a", "ttl-test", 1000)]).await;

    let pipeline = ContribPipeline::new(
        &harness.config,
        &github,
        &harness.llm,
        &harness.memory,
        &harness.event_bus,
    );

    let result = pipeline.hunt(1, 0, true, "normal").await.expect("hunt");

    // Repo was analyzed today → TTL not expired → skipped
    assert_eq!(
        result.repos_analyzed, 0,
        "Should skip repos analyzed within TTL window"
    );
}

// ── Test: Empty discovery returns gracefully ─────────────────────

#[tokio::test]
async fn test_hunt_empty_discovery_continues() {
    let server = wiremock::MockServer::start().await;
    let harness = HuntTestHarness::new();
    let github = harness.github_client(&server.uri());

    // Mock search returning empty results
    mock_github::mock_search_repos(&server, vec![]).await;

    let pipeline = ContribPipeline::new(
        &harness.config,
        &github,
        &harness.llm,
        &harness.memory,
        &harness.event_bus,
    );

    // 2 rounds, both empty → should complete without error
    let result = pipeline.hunt(2, 0, true, "normal").await.expect("hunt");

    assert_eq!(result.repos_analyzed, 0);
    assert_eq!(result.prs_created, 0);
    assert!(result.errors.is_empty(), "No errors expected");
}
