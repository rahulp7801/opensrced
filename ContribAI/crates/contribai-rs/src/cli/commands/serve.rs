//! Handles `Commands::Serve` — start the pipeline server for remote API access.

use crate::cli::{load_config, print_banner};
use colored::Colorize;
use console::style;

pub async fn run_serve(config_path: Option<&str>, host: String, port: u16) -> anyhow::Result<()> {
    print_banner();

    println!(
        "{} Starting pipeline server on {}:{}",
        style("🔌").bold(),
        host.cyan(),
        port.to_string().cyan()
    );
    println!(
        "  {} Open http://{}:{} in your browser",
        style("📡").bold(),
        host,
        port
    );
    println!();
    println!("  {} API endpoints:", style("📋").bold());
    println!("    GET  /api/health          — server health check");
    println!("    GET  /api/stats           — pipeline statistics");
    println!("    GET  /api/sessions        — list active sessions");
    println!("    POST /api/sessions/create — create a new session");
    println!("    POST /api/run             — trigger pipeline run");
    println!("    POST /api/run/target      — trigger targeted repo analysis");
    println!("    GET  /metrics             — Prometheus-format metrics");
    println!();

    let config = load_config(config_path)?;
    let memory = crate::cli::create_memory(&config)?;

    contribai::web::run_server(memory, &config, &host, port)
        .await
        .map_err(|e| anyhow::anyhow!("{}", e))
}
