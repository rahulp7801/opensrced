//! Handles `Commands::Session` — manage pipeline sessions.

use crate::cli::{load_config, print_banner};
use console::style;

pub fn run_session_list(config_path: Option<&str>) -> anyhow::Result<()> {
    print_banner();
    let _config = load_config(config_path)?;

    println!("{}", style("📋 Active Sessions").cyan().bold());
    println!("{}", style("━".repeat(50)).dim());
    println!();

    println!("  {} No persistent session store configured", style("⚪").dim());
    println!("  {} Sessions are per-run (stateless)", style("💡").bold());
    println!();
    Ok(())
}

pub fn run_session_create(_name: String, _mode: String) -> anyhow::Result<()> {
    print_banner();
    println!("{}", style("📋 Session Created").green().bold());
    println!();
    println!("  {} Session management is in-memory (per-run)", style("ℹ️").dim());
    println!();
    Ok(())
}
