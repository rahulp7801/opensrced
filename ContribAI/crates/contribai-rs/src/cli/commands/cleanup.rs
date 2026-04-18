//! Handles `Commands::Cleanup` — delete forks created by ContribAI.

use colored::Colorize;
use dialoguer::Confirm;

use crate::cli::{create_memory, load_config, print_banner};

pub async fn run_cleanup(config_path: Option<&str>, yes: bool) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;
    let memory = create_memory(&config)?;

    println!(
        "{}",
        "🧹 Cleanup — Forks created by ContribAI".cyan().bold()
    );
    println!("{}", "━".repeat(60).dimmed());
    println!();

    let all_prs = memory.get_prs(None, 1000)?;
    if all_prs.is_empty() {
        println!(
            "  {} No PRs in database. Nothing to clean up.",
            "💡".dimmed()
        );
        return Ok(());
    }

    // Group by fork
    let mut forks: std::collections::HashMap<
        String,
        Vec<std::collections::HashMap<String, String>>,
    > = std::collections::HashMap::new();

    for pr in &all_prs {
        let fork = pr.get("fork").map(|s| s.as_str()).unwrap_or("");
        if !fork.is_empty() {
            forks.entry(fork.to_string()).or_default().push(pr.clone());
        }
    }

    if forks.is_empty() {
        println!(
            "  {} No forks recorded in database (PRs may be direct branch contributions).",
            "💡".dimmed()
        );
        return Ok(());
    }

    println!(
        "  Found {} fork(s) in database\n",
        forks.len().to_string().cyan()
    );

    let mut safe_to_delete: Vec<String> = vec![];
    let mut has_open: Vec<String> = vec![];

    for (fork_name, prs) in &forks {
        println!("  📁 {}", fork_name.bold());
        let all_resolved = prs.iter().all(|pr| {
            let status = pr.get("status").map(|s| s.as_str()).unwrap_or("unknown");
            status == "merged" || status == "closed"
        });

        for pr in prs {
            let num = pr.get("pr_number").map(|s| s.as_str()).unwrap_or("?");
            let title: String = pr
                .get("title")
                .map(|s| s.as_str())
                .unwrap_or("")
                .chars()
                .take(50)
                .collect();
            let status = pr.get("status").map(|s| s.as_str()).unwrap_or("unknown");
            let icon = match status {
                "merged" => "🟢",
                "open" => "🟡",
                _ => "🔴",
            };
            println!("     PR #{}: {} [{} {}]", num.cyan(), title, icon, status);
        }

        if all_resolved {
            println!("     {} All PRs resolved — safe to delete\n", "✅".green());
            safe_to_delete.push(fork_name.clone());
        } else {
            println!("     {} Has open PRs — keeping\n", "⚠️".yellow());
            has_open.push(fork_name.clone());
        }
    }

    println!("{}", "━".repeat(60).dimmed());
    if !has_open.is_empty() {
        println!(
            "  {} {} fork(s) with open PRs (kept)",
            "⚠️".yellow(),
            has_open.len()
        );
    }

    if safe_to_delete.is_empty() {
        println!("  {} No forks to clean up.", "💡".dimmed());
        return Ok(());
    }

    println!(
        "  {} {} fork(s) safe to delete:",
        "✅".green(),
        safe_to_delete.len()
    );
    for f in &safe_to_delete {
        println!("    - {}", f.cyan());
    }

    let confirmed = yes
        || Confirm::new()
            .with_prompt(format!("\n  🗑️  Delete {} fork(s)?", safe_to_delete.len()))
            .default(false)
            .interact()?;

    if !confirmed {
        println!("  {}", "Cancelled.".dimmed());
        return Ok(());
    }

    for f in &safe_to_delete {
        let result = if cfg!(target_os = "windows") {
            std::process::Command::new("cmd")
                .args(["/c", "gh", "repo", "delete", f, "--yes"])
                .output()
        } else {
            std::process::Command::new("gh")
                .args(["repo", "delete", f, "--yes"])
                .output()
        };

        match result {
            Ok(out) if out.status.success() => println!("  {} Deleted {}", "✅".green(), f.cyan()),
            Ok(out) => {
                let err = String::from_utf8_lossy(&out.stderr);
                println!("  {} Failed to delete {}: {}", "❌".red(), f, err.trim());
            }
            Err(e) => println!("  {} Failed: {}", "❌".red(), e),
        }
    }

    println!("\n  🎉 Cleanup done!");
    Ok(())
}
