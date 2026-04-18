//! Handles `Commands::CircuitBreaker` — check LLM circuit breaker status.

use colored::Colorize;
use console::style;
use contribai::orchestrator::circuit_breaker::{CircuitBreaker, CircuitState};

use crate::cli::{load_config, print_banner};

pub async fn run_circuit_breaker_status(config_path: Option<&str>) -> anyhow::Result<()> {
    print_banner();

    println!("{}", style("⚡ Circuit Breaker Status").cyan().bold());
    println!("{}", "━".repeat(50).dimmed());
    println!();

    let config = load_config(config_path).unwrap_or_default();
    let cb = CircuitBreaker::new().with_thresholds(
        config.pipeline.circuit_breaker_failure_threshold,
        config.pipeline.circuit_breaker_success_threshold,
        config.pipeline.circuit_breaker_cooldown_secs,
    );

    println!("  {:<25} {:?}", style("State:").bold(), cb.state());
    println!("  {:<25} {}", style("Summary:").bold(), cb.summary());
    println!(
        "  {:<25} {}",
        style("Failure threshold:").bold(),
        config.pipeline.circuit_breaker_failure_threshold
    );
    println!(
        "  {:<25} {}",
        style("Success threshold:").bold(),
        config.pipeline.circuit_breaker_success_threshold
    );
    println!(
        "  {:<25} {}s",
        style("Cooldown:").bold(),
        config.pipeline.circuit_breaker_cooldown_secs
    );
    println!();

    match cb.state() {
        CircuitState::Closed => {
            println!(
                "  {} Circuit is CLOSED — LLM calls proceeding normally",
                style("✅").green()
            );
        }
        CircuitState::Open => {
            println!(
                "  {} Circuit is OPEN — LLM calls are blocked to save API quota",
                style("🔴").red().bold()
            );
            println!("  {} Wait for cooldown period or manually reset with `contribai run` (success will reset)", style("💡").bold());
        }
        CircuitState::HalfOpen => {
            println!(
                "  {} Circuit is HALF-OPEN — testing recovery with next LLM call",
                style("🟡").yellow()
            );
        }
    }

    println!();
    Ok(())
}
