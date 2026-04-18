//! Handles `Commands::Schedule` — start the scheduler for automated runs.

use colored::Colorize;

use crate::cli::{load_config, print_banner};

pub async fn run_schedule(config_path: Option<&str>, cron: String) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;

    println!("⏰ Starting scheduler with cron: {}", cron.cyan().bold());
    println!("   Press Ctrl+C to stop.\n");

    // Use Arc so the closure can own config data and re-create clients each run
    let config = std::sync::Arc::new(config);
    let config_clone = config.clone();

    let scheduler = contribai::scheduler::ContribScheduler::new(&cron, true)
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    scheduler
        .start(move || {
            let cfg = config_clone.clone();
            async move {
                let github = match contribai::github::client::GitHubClient::new(
                    &cfg.github.token,
                    cfg.github.rate_limit_buffer,
                ) {
                    Ok(g) => g,
                    Err(e) => return Err(e.to_string()),
                };
                let llm = match contribai::llm::provider::create_llm_provider(&cfg.llm)
                {
                    Ok(l) => l,
                    Err(e) => return Err(e.to_string()),
                };
                let db_path = cfg.storage.resolved_db_path();
                let memory =
                    match contribai::orchestrator::memory::Memory::open(&db_path) {
                        Ok(m) => m,
                        Err(e) => return Err(e.to_string()),
                    };
                let event_bus = contribai::core::events::EventBus::default();
                let pipeline = contribai::orchestrator::pipeline::ContribPipeline::new(
                    &cfg,
                    &github,
                    llm.as_ref(),
                    &memory,
                    &event_bus,
                );

                // KAIROS: Run → Patrol → Dream (full autonomous loop)
                tracing::info!("🔄 KAIROS cycle: Run → Patrol → Dream");

                // 1. Pipeline run (discover + analyze + PR)
                if let Err(e) = pipeline.run(None, cfg.pipeline.dry_run).await {
                    tracing::warn!(error = %e, "Pipeline run had errors");
                }

                // 2. Patrol (respond to review comments on open PRs)
                let mut patrol = contribai::pr::patrol::PrPatrol::new(
                    &github,
                    llm.as_ref(),
                )
                .with_memory(&memory);
                match memory.get_prs(Some("open"), 50) {
                    Ok(prs) => {
                        let pr_values: Vec<serde_json::Value> = prs
                            .iter()
                            .map(|pr| {
                                serde_json::json!({
                                    "repo": pr.get("repo").unwrap_or(&String::new()),
                                    "pr_number": pr.get("pr_number").unwrap_or(&String::new()).parse::<i64>().unwrap_or(0),
                                    "status": pr.get("status").unwrap_or(&String::new()),
                                })
                            })
                            .collect();
                        match patrol.patrol(&pr_values, false).await {
                            Ok(r) => tracing::info!(
                                checked = r.prs_checked,
                                fixes = r.fixes_pushed,
                                "Patrol complete"
                            ),
                            Err(e) => tracing::warn!(error = %e, "Patrol had errors"),
                        }
                    }
                    Err(e) => tracing::warn!(error = %e, "Could not load PR records"),
                }

                // 3. Dream (consolidate memory if gates are met)
                pipeline.maybe_dream();

                Ok(())
            }
        })
        .await;

    Ok(())
}
