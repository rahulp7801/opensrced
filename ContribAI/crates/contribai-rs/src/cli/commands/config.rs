//! Handles `Commands::Config`, `ConfigGet`, `ConfigSet`, `ConfigList` — show/edit configuration.

use colored::Colorize;

use crate::cli::config_editor;
use crate::cli::{load_config, print_banner};

pub fn run_config(config_path: Option<&str>) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;

    println!("{}", "⚙️  Current Configuration".cyan().bold());
    println!("{}", "━".repeat(50).dimmed());

    // GitHub token — show last 4 chars masked
    let token_display = if config.github.token.is_empty() {
        "(not set)".red().to_string()
    } else {
        let last4: String = config
            .github
            .token
            .chars()
            .rev()
            .take(4)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        format!("****{}", last4).yellow().to_string()
    };
    println!("  {:<18} {}", "GitHub token:".dimmed(), token_display);
    println!(
        "  {:<18} {}",
        "Max PRs/day:".dimmed(),
        config.github.max_prs_per_day.to_string().cyan()
    );

    println!(
        "  {:<18} {} / {}",
        "LLM:".dimmed(),
        config.llm.provider.cyan(),
        config.llm.model.dimmed()
    );

    let langs = config.discovery.languages.join(", ");
    println!(
        "  {:<18} {} | stars: {}-{}",
        "Discovery:".dimmed(),
        langs.cyan(),
        config.discovery.stars_min.to_string().dimmed(),
        config.discovery.stars_max.to_string().dimmed()
    );

    println!(
        "  {:<18} {} concurrent | quality: {}",
        "Pipeline:".dimmed(),
        config.pipeline.max_concurrent_repos.to_string().cyan(),
        config.pipeline.min_quality_score.to_string().dimmed()
    );

    let db_path = config.storage.resolved_db_path();
    println!(
        "  {:<18} {}",
        "Storage:".dimmed(),
        db_path.display().to_string().dimmed()
    );

    println!(
        "  {:<18} {} (enabled: {})",
        "Scheduler:".dimmed(),
        config.scheduler.cron.cyan(),
        if config.scheduler.enabled {
            "yes".green().to_string()
        } else {
            "no".red().to_string()
        }
    );

    Ok(())
}

pub fn run_config_get(config_path: Option<&str>, key: String) -> anyhow::Result<()> {
    let path = config_editor::resolve_config_path(config_path);
    config_editor::get_config_value(&path, &key)
}

pub fn run_config_set(config_path: Option<&str>, key: String, value: String) -> anyhow::Result<()> {
    let path = config_editor::resolve_config_path(config_path);
    config_editor::set_config_value(&path, &key, &value)
}

pub fn run_config_list(config_path: Option<&str>) -> anyhow::Result<()> {
    let path = config_editor::resolve_config_path(config_path);
    config_editor::list_config(&path)
}
