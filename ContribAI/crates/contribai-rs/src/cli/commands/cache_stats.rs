//! Handles `Commands::CacheStats` — show LLM response cache statistics.

use colored::Colorize;
use console::style;

use crate::cli::{load_config, print_banner};

pub fn run_cache_stats(config_path: Option<&str>) -> anyhow::Result<()> {
    print_banner();

    let config = load_config(config_path)?;

    if !config.llm.cache_enabled {
        println!("{}", "ℹ️  LLM cache is disabled in config".yellow());
        println!("  Enable with: llm.cache_enabled: true");
        return Ok(());
    }

    let cache_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".contribai")
        .join("llm_cache.db");

    if !cache_path.exists() {
        println!("{}", "📭 LLM cache does not exist yet".bright_black());
        println!("  Cache will be created on first LLM call");
        return Ok(());
    }

    let cache = contribai::llm::cache::LlmCache::new(&cache_path, config.llm.cache_ttl_days)?;
    let stats = cache.stats()?;

    println!(
        "{}",
        style("📊 LLM Response Cache Statistics").cyan().bold()
    );
    println!("{}", "━".repeat(50).dimmed());
    println!();
    println!("  {:<25} {}", style("Cache enabled:").bold(), "Yes".green());
    println!(
        "  {:<25} {} days",
        style("TTL:").bold(),
        config.llm.cache_ttl_days
    );
    println!(
        "  {:<25} {}",
        style("Total entries:").bold(),
        stats.total.to_string().cyan()
    );
    println!(
        "  {:<25} {}",
        style("Valid entries:").bold(),
        stats.valid.to_string().green()
    );
    println!(
        "  {:<25} {}",
        style("Expired entries:").bold(),
        stats.expired.to_string().yellow()
    );
    println!(
        "  {:<25} {:.1} KB",
        style("Database size:").bold(),
        stats.db_size_bytes as f64 / 1024.0
    );
    println!();
    if stats.total > 0 {
        let hit_rate = (stats.valid as f64 / stats.total as f64) * 100.0;
        println!(
            "  {} {:.1}% of entries are still valid",
            style("📈").bold(),
            hit_rate
        );
    }
    println!();

    Ok(())
}
