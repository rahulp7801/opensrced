//! Handles `Commands::Models` — list available LLM models and their capabilities.

use colored::Colorize;

use crate::cli::print_banner;

pub fn run_models(task_filter: Option<&str>) -> anyhow::Result<()> {
    struct ModelDef {
        name: &'static str,
        provider: &'static str,
        tier: &'static str,
        coding: u8,
        analysis: u8,
        speed: u8,
        cost: &'static str,
        best_for: &'static str,
    }

    const MODELS: &[ModelDef] = &[
        // ── Google Gemini 3.x (latest) ────────────────────────────────
        ModelDef {
            name: "gemini-3.1-pro-preview",
            provider: "google",
            tier: "PRO",
            coding: 10,
            analysis: 10,
            speed: 7,
            cost: "$1.25/$10.0",
            best_for: "analysis, code",
        },
        ModelDef {
            name: "gemini-3-pro-preview",
            provider: "google",
            tier: "PRO",
            coding: 10,
            analysis: 10,
            speed: 7,
            cost: "$1.25/$10.0",
            best_for: "analysis, code",
        },
        ModelDef {
            name: "gemini-3-flash-preview",
            provider: "google",
            tier: "FLASH",
            coding: 9,
            analysis: 9,
            speed: 9,
            cost: "$0.15/$0.60",
            best_for: "code, review",
        },
        ModelDef {
            name: "gemini-3.1-flash-lite-preview",
            provider: "google",
            tier: "LITE",
            coding: 8,
            analysis: 7,
            speed: 10,
            cost: "$0.02/$0.10",
            best_for: "docs, review",
        },
        // ── Google Gemini 2.5 (stable) ────────────────────────────────
        ModelDef {
            name: "gemini-2.5-pro",
            provider: "google",
            tier: "PRO",
            coding: 9,
            analysis: 9,
            speed: 7,
            cost: "$1.25/$10.0",
            best_for: "analysis, code",
        },
        ModelDef {
            name: "gemini-2.5-flash",
            provider: "google",
            tier: "FLASH",
            coding: 8,
            analysis: 8,
            speed: 9,
            cost: "$0.30/$2.50",
            best_for: "analysis, review, docs",
        },
        ModelDef {
            name: "gemini-2.5-flash-lite",
            provider: "google",
            tier: "LITE",
            coding: 7,
            analysis: 7,
            speed: 10,
            cost: "$0.10/$0.40",
            best_for: "docs, review",
        },
        // ── OpenAI ─────────────────────────────────────────────────────
        ModelDef {
            name: "gpt-5.4",
            provider: "openai",
            tier: "PRO",
            coding: 9,
            analysis: 9,
            speed: 7,
            cost: "$2.50/$15.0",
            best_for: "code, analysis",
        },
        ModelDef {
            name: "gpt-5.4-mini",
            provider: "openai",
            tier: "FLASH",
            coding: 8,
            analysis: 8,
            speed: 9,
            cost: "$0.75/$4.50",
            best_for: "code, review",
        },
        ModelDef {
            name: "gpt-5.4-nano",
            provider: "openai",
            tier: "LITE",
            coding: 7,
            analysis: 7,
            speed: 10,
            cost: "$0.20/$1.25",
            best_for: "docs, review",
        },
        // ── Anthropic ──────────────────────────────────────────────────
        ModelDef {
            name: "claude-opus-4.6",
            provider: "anthropic",
            tier: "PRO",
            coding: 10,
            analysis: 10,
            speed: 6,
            cost: "$5.00/$25.0",
            best_for: "code, analysis",
        },
        ModelDef {
            name: "claude-sonnet-4.6",
            provider: "anthropic",
            tier: "FLASH",
            coding: 9,
            analysis: 9,
            speed: 7,
            cost: "$3.00/$15.0",
            best_for: "code, analysis",
        },
        ModelDef {
            name: "claude-haiku-4.5",
            provider: "anthropic",
            tier: "LITE",
            coding: 7,
            analysis: 7,
            speed: 9,
            cost: "$1.00/$5.00",
            best_for: "docs, review",
        },
        // ── Ollama (local) ─────────────────────────────────────────────
        ModelDef {
            name: "llama3.3",
            provider: "ollama",
            tier: "LOCAL",
            coding: 8,
            analysis: 7,
            speed: 8,
            cost: "free",
            best_for: "all (offline)",
        },
        ModelDef {
            name: "qwen2.5-coder",
            provider: "ollama",
            tier: "LOCAL",
            coding: 9,
            analysis: 7,
            speed: 8,
            cost: "free",
            best_for: "code (offline)",
        },
        ModelDef {
            name: "deepseek-coder-v2",
            provider: "ollama",
            tier: "LOCAL",
            coding: 9,
            analysis: 7,
            speed: 7,
            cost: "free",
            best_for: "code (offline)",
        },
    ];

    let filter_lower = task_filter.map(|s| s.to_lowercase());
    let models: Vec<&ModelDef> = MODELS
        .iter()
        .filter(|m| {
            filter_lower
                .as_ref()
                .map(|f| m.best_for.contains(f.as_str()))
                .unwrap_or(true)
        })
        .collect();

    print_banner();

    if let Some(f) = task_filter {
        println!("{} {}", "🤖 Models for task:".cyan().bold(), f.yellow());
    } else {
        println!("{}", "🤖 Available LLM Models".cyan().bold());
    }
    println!("{}", "━".repeat(95).dimmed());
    println!(
        "  {:<30} {:<10} {:<8} {:>5} {:>6} {:>6}  {:<14} {}",
        "Model".bold(),
        "Provider".bold(),
        "Tier".bold(),
        "Code".bold(),
        "Analy".bold(),
        "Speed".bold(),
        "Cost (in/out)".bold(),
        "Best For".bold()
    );
    println!("{}", "─".repeat(95).dimmed());

    for m in &models {
        let tier_colored = match m.tier {
            "PRO" => m.tier.red().to_string(),
            "FLASH" => m.tier.yellow().to_string(),
            "LOCAL" => m.tier.green().to_string(),
            _ => m.tier.dimmed().to_string(),
        };
        println!(
            "  {:<30} {:<10} {:<16} {:>5} {:>6} {:>6}  {:<14} {}",
            m.name.cyan(),
            m.provider.dimmed(),
            tier_colored,
            m.coding,
            m.analysis,
            m.speed,
            m.cost,
            m.best_for.dimmed()
        );
    }

    println!();
    println!("{}", "Default Task Assignments:".bold());
    println!(
        "  {:<20} {}",
        "analysis:".dimmed(),
        "gemini-3-flash-preview".cyan()
    );
    println!(
        "  {:<20} {}",
        "code:".dimmed(),
        "gemini-3.1-pro-preview".cyan()
    );
    println!(
        "  {:<20} {}",
        "review:".dimmed(),
        "gemini-3-flash-preview".cyan()
    );
    println!(
        "  {:<20} {}",
        "docs:".dimmed(),
        "gemini-3.1-flash-lite-preview".cyan()
    );
    println!();
    Ok(())
}
