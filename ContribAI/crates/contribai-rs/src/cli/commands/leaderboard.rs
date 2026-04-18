//! Handles `Commands::Leaderboard` — contribution leaderboard and merge rate statistics.

use colored::Colorize;

use crate::cli::{create_memory, load_config, print_banner};

pub fn run_leaderboard(config_path: Option<&str>, limit: usize) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;
    let memory = create_memory(&config)?;

    println!("{}", "🏆 Contribution Leaderboard".cyan().bold());
    println!("{}", "━".repeat(60).dimmed());
    println!();

    let stats = memory.get_stats()?;
    let total = stats.get("total_prs_submitted").copied().unwrap_or(0);
    let merged = stats.get("prs_merged").copied().unwrap_or(0);
    let closed = stats.get("prs_closed").copied().unwrap_or(0);
    let open = total.saturating_sub(merged + closed);
    let merge_rate = if total > 0 { merged * 100 / total } else { 0 };

    println!(
        "  {:<18} {}",
        "Total PRs:".dimmed(),
        total.to_string().cyan().bold()
    );
    println!(
        "  {:<18} {}  {}  {}",
        "Status:".dimmed(),
        format!("✅ Merged: {}", merged).green(),
        format!("❌ Closed: {}", closed).red(),
        format!("🟡 Open: {}", open).yellow()
    );
    println!(
        "  {:<18} {}",
        "Merge rate:".dimmed(),
        format!("{}%", merge_rate).cyan().bold()
    );
    println!();

    // Per-repo breakdown from memory
    let prs = memory.get_prs(None, limit * 5)?;
    if !prs.is_empty() {
        // Aggregate by repo
        let mut repo_map: std::collections::HashMap<String, (u32, u32, u32)> =
            std::collections::HashMap::new();
        for pr in &prs {
            let repo = pr
                .get("repo")
                .map(|s| s.as_str())
                .unwrap_or("unknown")
                .to_string();
            let status = pr.get("status").map(|s| s.as_str()).unwrap_or("unknown");
            let entry = repo_map.entry(repo).or_insert((0, 0, 0));
            entry.0 += 1;
            if status == "merged" {
                entry.1 += 1;
            }
            if status == "closed" {
                entry.2 += 1;
            }
        }

        let mut repos: Vec<(String, u32, u32, u32)> = repo_map
            .into_iter()
            .map(|(r, (t, m, c))| (r, t, m, c))
            .collect();
        repos.sort_by(|a, b| b.2.cmp(&a.2).then(b.1.cmp(&a.1)));
        repos.truncate(limit);

        println!(
            "{:<32} {:>6} {:>8} {:>8} {:>6}",
            "Repo".bold(),
            "Total".bold(),
            "Merged".bold(),
            "Closed".bold(),
            "Rate".bold()
        );
        println!("{}", "─".repeat(64).dimmed());

        for (repo, total, merged, closed) in &repos {
            let rate = if *total > 0 { merged * 100 / total } else { 0 };
            let rate_str = format!("{}%", rate);
            let rate_colored = if rate >= 70 {
                rate_str.green().to_string()
            } else if rate >= 40 {
                rate_str.yellow().to_string()
            } else {
                rate_str.red().to_string()
            };
            let repo_short: String = repo.chars().take(30).collect();
            println!(
                "  {:<30} {:>6} {:>8} {:>8} {:>6}",
                repo_short,
                total.to_string().cyan(),
                merged.to_string().green(),
                closed.to_string().red(),
                rate_colored
            );
        }
    } else {
        println!("  {}", "No PR history yet.".dimmed());
    }

    println!();
    Ok(())
}
