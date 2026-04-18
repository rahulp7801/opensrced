//! Handles `Commands::Patrol` — monitor open PRs for review comments and respond.

use colored::Colorize;

use crate::cli::{create_github, create_llm, create_memory, load_config, print_banner};

pub async fn run_patrol(config_path: Option<&str>, dry_run: bool) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;

    println!(
        "👁  {} {}",
        "Patrol mode".cyan().bold(),
        if dry_run {
            "(DRY RUN)".yellow().to_string()
        } else {
            "(LIVE)".green().to_string()
        }
    );

    let github = create_github(&config)?;
    let llm = create_llm(&config)?;
    let memory = create_memory(&config)?;

    // Get open PRs from memory
    let prs = memory.get_prs(Some("open"), 50)?;
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

    let mut patrol =
        contribai::pr::patrol::PrPatrol::new(&github, llm.as_ref()).with_memory(&memory);
    let result = patrol
        .patrol(&pr_values, dry_run)
        .await
        .map_err(|e| anyhow::anyhow!("{}", e))?;

    // Auto-clean PRs that returned 404
    let mut cleaned = 0u32;
    for err in &result.errors {
        if let Some(rest) = err.strip_prefix("NOT_FOUND:") {
            let parts: Vec<&str> = rest.rsplitn(2, ':').collect();
            if parts.len() == 2 {
                let pr_num: i64 = parts[0].parse().unwrap_or(0);
                let repo_name = parts[1];
                if pr_num > 0 {
                    let _ = memory.update_pr_status(repo_name, pr_num, "closed");
                    cleaned += 1;
                }
            }
        }
    }

    println!("\n{}", "━".repeat(50).dimmed());
    println!(
        "  {} PRs checked:  {}",
        "📊".bold(),
        result.prs_checked.to_string().cyan()
    );
    println!(
        "  {} Fixes pushed: {}",
        "🔧".bold(),
        result.fixes_pushed.to_string().green()
    );
    println!(
        "  {} Replies sent: {}",
        "💬".bold(),
        result.replies_sent.to_string().cyan()
    );
    if result.prs_skipped > 0 {
        println!(
            "  {} Skipped:     {}",
            "⏭".bold(),
            result.prs_skipped.to_string().yellow()
        );
    }
    if cleaned > 0 {
        println!(
            "  {} Cleaned:     {} stale PRs removed from memory",
            "🗑️".bold(),
            cleaned.to_string().red()
        );
    }
    Ok(())
}
