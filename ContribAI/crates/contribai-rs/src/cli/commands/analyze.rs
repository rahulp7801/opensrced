//! Handles `Commands::Analyze` — dry-run analysis only, no PRs created.

use colored::Colorize;

use crate::cli::{
    create_github, create_llm, create_memory, load_config, parse_github_url, print_banner,
    print_result,
};

pub async fn run_analyze(config_path: Option<&str>, url: String) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;

    println!("🔍 Analyzing (dry-run): {}", url.cyan().bold());
    println!();

    let (owner, name) = parse_github_url(&url)?;

    let github = create_github(&config)?;
    let llm = create_llm(&config)?;
    let memory = create_memory(&config)?;
    let event_bus = contribai::core::events::EventBus::default();

    let pipeline = contribai::orchestrator::pipeline::ContribPipeline::new(
        &config,
        &github,
        llm.as_ref(),
        &memory,
        &event_bus,
    );

    // Always dry_run=true — analysis only, no PRs created
    let result = pipeline.run_targeted(&owner, &name, true).await?;
    print_result(&result, true);
    Ok(())
}
