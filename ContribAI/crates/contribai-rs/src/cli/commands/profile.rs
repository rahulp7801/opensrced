//! Handles `Commands::Profile` — run pipeline with a named profile.

use colored::Colorize;

use crate::cli::{create_github, create_llm, create_memory, print_result};

#[allow(dead_code)]
struct Profile {
    name: &'static str,
    description: &'static str,
    analyzers: &'static [&'static str],
    contribution_types: &'static [&'static str],
    severity_threshold: &'static str,
    max_prs_per_day: u32,
    max_repos: u32,
    dry_run: bool,
}

const PROFILES: &[Profile] = &[
    Profile {
        name: "security-focused",
        description: "Focus on security vulnerabilities and fixes",
        analyzers: &["security"],
        contribution_types: &["security_fix", "code_quality"],
        severity_threshold: "high",
        max_prs_per_day: 5,
        max_repos: 10,
        dry_run: false,
    },
    Profile {
        name: "docs-focused",
        description: "Focus on documentation improvements",
        analyzers: &["docs"],
        contribution_types: &["docs_improve"],
        severity_threshold: "low",
        max_prs_per_day: 10,
        max_repos: 15,
        dry_run: false,
    },
    Profile {
        name: "full-scan",
        description: "Run all analyzers with low threshold",
        analyzers: &[
            "security",
            "code_quality",
            "docs",
            "performance",
            "refactor",
        ],
        contribution_types: &[
            "security_fix",
            "docs_improve",
            "code_quality",
            "performance_opt",
            "refactor",
        ],
        severity_threshold: "low",
        max_prs_per_day: 20,
        max_repos: 20,
        dry_run: false,
    },
    Profile {
        name: "gentle",
        description: "Low-impact: small fixes, dry run by default",
        analyzers: &["docs", "code_quality"],
        contribution_types: &["docs_improve", "code_quality"],
        severity_threshold: "high",
        max_prs_per_day: 3,
        max_repos: 2,
        dry_run: true,
    },
];

pub async fn run_profile(
    name: &str,
    dry_run: bool,
    config: &contribai::core::config::ContribAIConfig,
) -> anyhow::Result<()> {
    // "list" keyword -> show all profiles
    if name == "list" || name == "--list" {
        println!("{}", "📋 Available Profiles".cyan().bold());
        println!("{}", "━".repeat(70).dimmed());
        println!(
            "  {:<22} {:<35} {:<10} {}",
            "Name".bold(),
            "Description".bold(),
            "Threshold".bold(),
            "Dry Run".bold()
        );
        println!("{}", "─".repeat(70).dimmed());
        for p in PROFILES {
            println!(
                "  {:<22} {:<35} {:<10} {}",
                p.name.cyan(),
                p.description.chars().take(35).collect::<String>(),
                p.severity_threshold.yellow(),
                if p.dry_run {
                    "yes".green().to_string()
                } else {
                    "no".dimmed().to_string()
                }
            );
        }
        println!();
        println!(
            "  {} Use: {}",
            "→".dimmed(),
            "contribai profile <name>".cyan()
        );
        return Ok(());
    }

    let profile = PROFILES.iter().find(|p| p.name == name);
    let profile = match profile {
        Some(p) => p,
        None => {
            anyhow::bail!(
                "Profile '{}' not found. Available: {}",
                name,
                PROFILES
                    .iter()
                    .map(|p| p.name)
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    };

    let effective_dry_run = dry_run || profile.dry_run;

    println!(
        "  {} Running with profile: {}",
        "🎯".cyan(),
        profile.name.cyan().bold()
    );
    println!("  {}", profile.description.dimmed());
    println!("  Analyzers: {}", profile.analyzers.join(", ").yellow());
    println!("  Severity:  {}", profile.severity_threshold.yellow());
    println!(
        "  Max PRs/day: {}",
        profile.max_prs_per_day.to_string().cyan()
    );
    if effective_dry_run {
        println!("  {} DRY RUN mode", "[DRY RUN]".yellow().bold());
    }
    println!();

    let github = create_github(config)?;
    let llm = create_llm(config)?;
    let memory = create_memory(config)?;
    let event_bus = contribai::core::events::EventBus::default();

    let pipeline = contribai::orchestrator::pipeline::ContribPipeline::new(
        config,
        &github,
        llm.as_ref(),
        &memory,
        &event_bus,
    );

    let result = pipeline.run(None, effective_dry_run).await?;
    print_result(&result, effective_dry_run);
    Ok(())
}
