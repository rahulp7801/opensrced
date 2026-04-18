//! Handles `Commands::Doctor` — run environment diagnostics.

use console::style;

use crate::cli::{create_memory, load_config};

pub async fn run_doctor(config_path: Option<&str>) -> anyhow::Result<()> {
    println!(
        "{}",
        style("🩺 Doctor — Environment Diagnostics").cyan().bold()
    );
    println!("{}", style("━".repeat(50)).dim());
    println!();

    let mut pass = 0u32;
    let mut fail = 0u32;

    // ── 1. Config file ────────────────────────────────
    print!("  {:.<40} ", "Config file parseable");
    match load_config(config_path) {
        Ok(config) => {
            println!("{}", style("✅OK").green());
            pass += 1;

            // ── 2. GitHub token ────────────────────────────────
            print!("  {:.<40} ", "GitHub token valid");
            match contribai::github::client::GitHubClient::new(
                &config.github.token,
                config.github.rate_limit_buffer,
            ) {
                Ok(github) => {
                    // Try an API call
                    match github.get_repo_details("octocat", "hello-world").await {
                        Ok(_) => {
                            println!("{}", style("✅OK").green());
                            pass += 1;
                        }
                        Err(e) => {
                            println!("{} ({})", style("❌FAIL").red(), e);
                            fail += 1;
                        }
                    }

                    // ── 3. Rate limit status ────────────────────
                    print!("  {:.<40} ", "GitHub rate limit");
                    let rate = github.get_rate_status();
                    if rate.is_low {
                        println!(
                            "{} ({} remaining)",
                            style("⚠️  LOW").yellow(),
                            rate.remaining
                        );
                        fail += 1;
                    } else {
                        println!("{} ({} remaining)", style("✅OK").green(), rate.remaining);
                        pass += 1;
                    }
                }
                Err(e) => {
                    println!("{} ({})", style("❌FAIL").red(), e);
                    fail += 1;
                    // Skip rate limit check
                    print!("  {:.<40} ", "GitHub rate limit");
                    println!("{}", style("⏭️  SKIP").dim());
                }
            }

            // ── 4. Memory DB ────────────────────────────────────
            print!("  {:.<40} ", "Memory database");
            match create_memory(&config) {
                Ok(memory) => {
                    // Test a read operation
                    match memory.get_prs(None, 1) {
                        Ok(_) => {
                            println!("{}", style("✅OK").green());
                            pass += 1;
                        }
                        Err(e) => {
                            println!("{} ({})", style("❌FAIL").red(), e);
                            fail += 1;
                        }
                    }
                }
                Err(e) => {
                    println!("{} ({})", style("❌FAIL").red(), e);
                    fail += 1;
                }
            }

            // ── 5. LLM provider ────────────────────────────────
            print!(
                "  {:.<40} ",
                format!("LLM provider ({})", config.llm.provider)
            );
            match contribai::llm::provider::create_llm_provider(&config.llm) {
                Ok(llm) => {
                    match llm
                        .complete("Reply with exactly: OK", None, Some(0.0), Some(10))
                        .await
                    {
                        Ok(resp) => {
                            if resp.trim().is_empty() {
                                println!("{} (empty response)", style("⚠️  WARN").yellow());
                                fail += 1;
                            } else {
                                println!("{}", style("✅OK").green());
                                pass += 1;
                            }
                        }
                        Err(e) => {
                            let msg = format!("{}", e);
                            let short = if msg.len() > 60 { &msg[..60] } else { &msg };
                            println!("{} ({})", style("❌FAIL").red(), short);
                            fail += 1;
                        }
                    }
                }
                Err(e) => {
                    println!("{} ({})", style("❌FAIL").red(), e);
                    fail += 1;
                }
            }

            // ── 6. gcloud (if Vertex AI) ──────────────────────
            if config.llm.use_vertex() {
                print!("  {:.<40} ", "gcloud CLI available");
                #[cfg(target_os = "windows")]
                let result = std::process::Command::new("cmd")
                    .args(["/c", "gcloud", "version"])
                    .output();
                #[cfg(not(target_os = "windows"))]
                let result = std::process::Command::new("gcloud").arg("version").output();
                match result {
                    Ok(out) if out.status.success() => {
                        println!("{}", style("✅OK").green());
                        pass += 1;
                    }
                    _ => {
                        println!("{} (gcloud not found)", style("❌FAIL").red());
                        fail += 1;
                    }
                }
            }

            // ── 7. Version ──────────────────────────────────────
            print!("  {:.<40} ", "ContribAI version");
            println!("{}", style(format!("v{}", contribai::VERSION)).cyan());
            pass += 1;
        }
        Err(e) => {
            println!("{} ({})", style("❌FAIL").red(), e);
            fail += 1;
            println!();
            println!(
                "  {} Config is broken — fix it first (run `contribai init`)",
                style("💡").bold()
            );
        }
    }

    // ── Summary ────────────────────────────────────────
    println!();
    println!("{}", style("━".repeat(50)).dim());
    if fail == 0 {
        println!(
            "  {} All {} checks passed — ready to contribute!",
            style("🎉").bold(),
            pass
        );
    } else {
        println!(
            "  {} {}/{} checks passed, {} failed",
            style("⚠️").bold(),
            pass,
            pass + fail,
            style(fail).red().bold()
        );
    }
    println!();
    Ok(())
}
