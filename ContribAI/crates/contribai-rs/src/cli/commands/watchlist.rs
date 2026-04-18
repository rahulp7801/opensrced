//! Handles `Commands::Watchlist` — sweep all repositories in the watchlist.

use colored::Colorize;

use crate::cli::{create_github, create_llm, create_memory, load_config, print_banner};

pub async fn run_watchlist(config_path: Option<&str>, dry_run: bool) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;

    let watchlist = &config.discovery.watchlist;
    if watchlist.is_empty() {
        println!(
            "{} No repositories in watchlist. Add repos to config.yaml under discovery.watchlist:",
            "⚠️".yellow()
        );
        println!();
        println!("  discovery:");
        println!("    watchlist:");
        println!("      - \"owner/repo\"");
        println!("      - \"myorg/myproject\"");
        return Ok(());
    }

    println!(
        "📋 Watchlist sweep: {} repo(s) {}",
        watchlist.len().to_string().cyan().bold(),
        if dry_run {
            "(DRY RUN)".yellow().to_string()
        } else {
            "(LIVE)".green().to_string()
        }
    );
    println!();

    let github = create_github(&config)?;
    let llm = create_llm(&config)?;
    let memory = create_memory(&config)?;
    let event_bus = contribai::core::events::EventBus::default();

    let pipeline = contribai::orchestrator::pipeline::ContribPipeline::new(
        &config,
        &github,
        llm.as_ref(),
        &memory,
        &event_bus,
    );

    let mut total_findings = 0usize;
    let mut total_prs = 0usize;

    for (i, repo_ref) in watchlist.iter().enumerate() {
        let parts: Vec<&str> = repo_ref.splitn(2, '/').collect();
        if parts.len() != 2 {
            println!(
                "  {} Skipping invalid entry: {} (expected \"owner/repo\")",
                "⚠️".yellow(),
                repo_ref.red()
            );
            continue;
        }
        let (owner, name) = (parts[0], parts[1]);

        println!(
            "  [{}/{}] 🎯 {}",
            (i + 1).to_string().cyan(),
            watchlist.len(),
            repo_ref.bold()
        );

        match pipeline.run_targeted(owner, name, dry_run).await {
            Ok(result) => {
                total_findings += result.findings_total;
                total_prs += result.prs_created;
                println!(
                    "         {} findings, {} PRs",
                    result.findings_total, result.prs_created
                );
            }
            Err(e) => {
                println!("         {} {}", "Error:".red(), e);
            }
        }
        println!();
    }

    println!(
        "📊 Watchlist complete: {} total findings, {} PRs submitted",
        total_findings.to_string().cyan().bold(),
        total_prs.to_string().green().bold(),
    );
    Ok(())
}
