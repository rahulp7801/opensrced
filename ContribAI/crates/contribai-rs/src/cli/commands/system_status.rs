//! Handles `Commands::SystemStatus` — show system status including DB, rate limits, scheduler.

use colored::Colorize;

use crate::cli::{create_github, create_memory, load_config, print_banner};

pub async fn run_system_status(config_path: Option<&str>) -> anyhow::Result<()> {
    print_banner();
    println!("{}", "📊 ContribAI System Status".cyan().bold());
    println!("{}", "━".repeat(60).dimmed());
    println!();

    let config = load_config(config_path)?;
    let memory = create_memory(&config)?;
    let stats = memory.get_stats()?;

    // Memory DB
    let db_path = config.storage.resolved_db_path();
    let db_size = std::fs::metadata(&db_path)
        .map(|m| format!("{:.1} KB", m.len() as f64 / 1024.0))
        .unwrap_or_else(|_| "not found".to_string());

    println!("{}", "  💾 Memory Database".bold());
    println!(
        "  {:<25} {}",
        "Path:".dimmed(),
        db_path.display().to_string().cyan()
    );
    println!("  {:<25} {}", "Size:".dimmed(), db_size.cyan());
    println!(
        "  {:<25} {}",
        "Repos analyzed:".dimmed(),
        stats
            .get("total_repos_analyzed")
            .copied()
            .unwrap_or(0)
            .to_string()
            .cyan()
    );
    println!(
        "  {:<25} {}",
        "PRs submitted:".dimmed(),
        stats
            .get("total_prs_submitted")
            .copied()
            .unwrap_or(0)
            .to_string()
            .cyan()
    );
    println!(
        "  {:<25} {}  {}  {}",
        "PR status:".dimmed(),
        format!("✅ {}", stats.get("prs_merged").copied().unwrap_or(0)).green(),
        format!("❌ {}", stats.get("prs_closed").copied().unwrap_or(0)).red(),
        format!("🟡 open:{}", {
            let t = stats.get("total_prs_submitted").copied().unwrap_or(0);
            let m = stats.get("prs_merged").copied().unwrap_or(0);
            let c = stats.get("prs_closed").copied().unwrap_or(0);
            t.saturating_sub(m + c)
        })
        .yellow()
    );
    println!();

    // Events log
    let events_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".contribai")
        .join("events.jsonl");
    if events_path.exists() {
        let lines = std::fs::read_to_string(&events_path)
            .map(|s| s.lines().count())
            .unwrap_or(0);
        println!("{}", "  📋 Event Log".bold());
        println!(
            "  {:<25} {}",
            "Path:".dimmed(),
            events_path.display().to_string().cyan()
        );
        println!("  {:<25} {}", "Events:".dimmed(), lines.to_string().cyan());
        println!();
    }

    // GitHub rate limit
    println!("{}", "  🔑 GitHub API".bold());
    let github = create_github(&config);
    match github {
        Ok(gh) => match gh.check_rate_limit().await {
            Ok(info) => {
                let remaining = info.remaining;
                let color = if remaining > 1000 {
                    "green"
                } else if remaining > 100 {
                    "yellow"
                } else {
                    "red"
                };
                let remaining_str = remaining.to_string();
                let displayed = match color {
                    "green" => remaining_str.green().to_string(),
                    "yellow" => remaining_str.yellow().to_string(),
                    _ => remaining_str.red().to_string(),
                };
                println!(
                    "  {:<25} {} / {} requests remaining",
                    "Rate limit:".dimmed(),
                    displayed,
                    info.limit
                );
            }
            Err(_) => println!(
                "  {:<25} {}",
                "Rate limit:".dimmed(),
                "could not check".dimmed()
            ),
        },
        Err(_) => println!(
            "  {:<25} {}",
            "Rate limit:".dimmed(),
            "token not configured".red()
        ),
    }
    println!();

    // LLM provider
    println!("{}", "  🤖 LLM Provider".bold());
    println!(
        "  {:<25} {}",
        "Provider:".dimmed(),
        config.llm.provider.cyan()
    );
    println!("  {:<25} {}", "Model:".dimmed(), config.llm.model.cyan());
    if !config.llm.vertex_project.is_empty() {
        println!(
            "  {:<25} {}",
            "Vertex project:".dimmed(),
            config.llm.vertex_project.cyan()
        );
    }
    println!();

    // Scheduler
    println!("{}", "  ⏰ Scheduler".bold());
    println!(
        "  {:<25} {}",
        "Status:".dimmed(),
        if config.scheduler.enabled {
            "enabled".green().to_string()
        } else {
            "disabled".dimmed().to_string()
        }
    );
    println!(
        "  {:<25} {}",
        "Cron:".dimmed(),
        config.scheduler.cron.cyan()
    );
    println!();

    Ok(())
}
