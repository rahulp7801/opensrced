//! Handles `Commands::Status` — show submitted PRs and their statuses.

use colored::Colorize;

use crate::cli::{create_memory, load_config, print_banner};

pub async fn run_status(
    config_path: Option<&str>,
    filter: Option<String>,
    limit: usize,
) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;
    let memory = create_memory(&config)?;

    let prs = memory.get_prs(filter.as_deref(), limit)?;

    println!("{}", "📋 Submitted PRs".cyan().bold());
    println!("{}", "━".repeat(80).dimmed());

    if prs.is_empty() {
        println!("  No PRs found.");
        return Ok(());
    }

    println!(
        "  {:>4}  {:<30}  {:<8}  {}",
        "PR#".dimmed(),
        "Repo".dimmed(),
        "Status".dimmed(),
        "URL".dimmed()
    );
    println!("  {}", "─".repeat(76).dimmed());

    for pr in &prs {
        let pr_number = pr.get("pr_number").map(|s| s.as_str()).unwrap_or("?");
        let repo = pr.get("repo").map(|s| s.as_str()).unwrap_or("unknown");
        let status_str = pr.get("status").map(|s| s.as_str()).unwrap_or("unknown");
        let url = pr.get("url").map(|s| s.as_str()).unwrap_or("");

        let status_colored = match status_str {
            "merged" => status_str.green().to_string(),
            "open" => status_str.cyan().to_string(),
            "closed" => status_str.red().to_string(),
            _ => status_str.dimmed().to_string(),
        };

        let repo_short: String = repo.chars().take(28).collect();
        println!(
            "  {:>4}  {:<30}  {:<8}  {}",
            format!("#{}", pr_number).cyan(),
            repo_short,
            status_colored,
            url.dimmed(),
        );
    }

    println!("\n  Showing {} PR(s).", prs.len().to_string().cyan());
    Ok(())
}
