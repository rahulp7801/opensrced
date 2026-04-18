//! Handles `Commands::CacheClear` — clear the LLM response cache.

use colored::Colorize;
use console::style;
use dialoguer::Confirm;

use crate::cli::{load_config, print_banner};

pub fn run_cache_clear(config_path: Option<&str>, yes: bool) -> anyhow::Result<()> {
    print_banner();

    let config = load_config(config_path)?;

    if !config.llm.cache_enabled {
        println!(
            "{}",
            "ℹ️  LLM cache is disabled — nothing to clear".yellow()
        );
        return Ok(());
    }

    let cache_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".contribai")
        .join("llm_cache.db");

    if !cache_path.exists() {
        println!(
            "{}",
            "📭 LLM cache does not exist — nothing to clear".bright_black()
        );
        return Ok(());
    }

    let cache = contribai::llm::cache::LlmCache::new(&cache_path, config.llm.cache_ttl_days)?;
    let stats = cache.stats()?;

    if stats.total == 0 {
        println!("{}", "📭 Cache is already empty".bright_black());
        return Ok(());
    }

    if !yes {
        let confirmed = Confirm::new()
            .with_prompt(format!(
                "Clear {} cache entries? (db size: {:.1} KB)",
                stats.total,
                stats.db_size_bytes as f64 / 1024.0
            ))
            .default(false)
            .interact()?;

        if !confirmed {
            println!("{}", "Cancelled".bright_black());
            return Ok(());
        }
    }

    let cleared = cache.clear()?;
    println!(
        "{} Cleared {} cache entries",
        style("✅").green(),
        cleared.to_string().cyan()
    );

    Ok(())
}
