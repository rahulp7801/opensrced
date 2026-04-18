//! Handles `Commands::Dream` — consolidate memory into durable repo profiles.

use colored::Colorize;
use console::style;

use crate::cli::{create_memory, load_config};

pub fn run_dream(config_path: Option<&str>, force: bool) -> anyhow::Result<()> {
    println!("{}", style("💤 Dream — Memory Consolidation").cyan().bold());
    println!("{}", "━".repeat(50).dimmed());
    println!();

    let config = load_config(config_path)?;
    let memory = create_memory(&config)?;

    // Show pre-dream stats
    let stats = memory
        .get_dream_stats()
        .map_err(|e| anyhow::anyhow!("{}", e))?;
    println!(
        "  {:<18} {}",
        style("Last dream:").bold(),
        stats.get("last_dream").unwrap_or(&"never".into())
    );
    println!(
        "  {:<18} {}",
        style("Sessions since:").bold(),
        stats.get("sessions_since_dream").unwrap_or(&"0".into())
    );
    println!(
        "  {:<18} {}",
        style("Repo profiles:").bold(),
        stats.get("repo_profiles").unwrap_or(&"0".into())
    );
    println!();

    // Check gates
    let should = memory
        .should_dream()
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    if !should && !force {
        println!(
            "  {} Dream gates not met (need 24h + 5 sessions).",
            style("💭").bold()
        );
        println!("  Use {} to override.", style("--force").yellow());
        return Ok(());
    }

    println!("  {} Running dream consolidation...", style("🌙").bold());
    println!();

    let result = memory.run_dream().map_err(|e| anyhow::anyhow!("{}", e))?;

    if result.success {
        println!("  {} Dream complete!", style("✅").bold());
        println!(
            "  {:<18} {}",
            style("Repos profiled:").bold(),
            style(result.repos_profiled.to_string()).green()
        );
        println!(
            "  {:<18} {}",
            style("Entries pruned:").bold(),
            style(result.entries_pruned.to_string()).yellow()
        );

        // Show updated profiles
        let board = memory
            .get_leaderboard(10)
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        if !board.is_empty() {
            println!();
            println!("  {}", style("Repo Profiles:").cyan().bold());
            for entry in &board {
                let repo = entry.get("repo").map(|s| s.as_str()).unwrap_or("?");
                let rate = entry.get("merge_rate").map(|s| s.as_str()).unwrap_or("?");
                let preferred = entry.get("preferred").map(|s| s.as_str()).unwrap_or("[]");
                println!(
                    "    {} {:<30} merge rate: {} preferred: {}",
                    style("•").dim(),
                    style(repo).white(),
                    style(rate).green(),
                    style(preferred).dim()
                );
            }
        }
    } else {
        println!("  {} Dream consolidation failed.", style("❌").bold());
    }

    println!();
    Ok(())
}
