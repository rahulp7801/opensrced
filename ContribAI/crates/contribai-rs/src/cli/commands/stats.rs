//! Handles `Commands::Stats` — show contribution statistics.

use colored::Colorize;

use crate::cli::{create_memory, load_config, print_banner};

pub async fn run_stats(config_path: Option<&str>) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;
    let memory = create_memory(&config)?;

    let stats = memory.get_stats()?;

    println!("{}", "📊 ContribAI Statistics".cyan().bold());
    println!("{}", "━".repeat(40).dimmed());
    println!(
        "  Repos analyzed:  {}",
        stats
            .get("total_repos_analyzed")
            .unwrap_or(&0)
            .to_string()
            .cyan()
    );
    println!(
        "  PRs submitted:   {}",
        stats
            .get("total_prs_submitted")
            .unwrap_or(&0)
            .to_string()
            .cyan()
    );
    println!(
        "  PRs merged:      {}",
        stats.get("prs_merged").unwrap_or(&0).to_string().green()
    );
    println!(
        "  Total runs:      {}",
        stats.get("total_runs").unwrap_or(&0).to_string().cyan()
    );

    // Recent PRs
    let prs = memory.get_prs(None, 5)?;
    if !prs.is_empty() {
        println!("\n{}", "Recent PRs:".bold());
        for pr in &prs {
            let status_str = pr.get("status").map(|s| s.as_str()).unwrap_or("unknown");
            let status = match status_str {
                "merged" => status_str.green().to_string(),
                "open" => status_str.cyan().to_string(),
                "closed" => status_str.red().to_string(),
                _ => status_str.dimmed().to_string(),
            };
            println!(
                "  #{} {} [{}] {}",
                pr.get("pr_number").unwrap_or(&String::new()),
                pr.get("repo").unwrap_or(&String::new()).dimmed(),
                status,
                pr.get("title").unwrap_or(&String::new()),
            );
        }
    }

    Ok(())
}
