//! Handles `Commands::NotifyTest` — send test notifications to configured channels.

use colored::Colorize;

use crate::cli::load_config;

pub async fn run_notify_test(config_path: Option<&str>) -> anyhow::Result<()> {
    let config = load_config(config_path)?;
    let n = &config.notifications;

    let slack = n.slack_webhook.as_deref().unwrap_or("");
    let discord = n.discord_webhook.as_deref().unwrap_or("");
    let tg_token = n.telegram_token.as_deref().unwrap_or("");
    let tg_chat = n.telegram_chat_id.as_deref().unwrap_or("");

    let channels_configured = !slack.is_empty() || !discord.is_empty() || !tg_token.is_empty();

    if !channels_configured {
        println!(
            "  {} No notification channels configured in config.yaml",
            "⚠️".yellow()
        );
        println!("  Set one of these first:");
        println!(
            "    {}",
            "contribai config-set notifications.slack_webhook https://hooks.slack.com/services/..."
                .cyan()
        );
        println!("    {}", "contribai config-set notifications.discord_webhook https://discord.com/api/webhooks/...".cyan());
        println!(
            "    {}",
            "contribai config-set notifications.telegram_token <bot-token>".cyan()
        );
        return Ok(());
    }

    println!("{}", "📣 Sending test notifications...".cyan().bold());
    println!("{}", "━".repeat(50).dimmed());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let title = "🤖 ContribAI Test Notification";
    let body  = "✅ Your ContribAI notifications are working! This is a test message from `contribai notify-test`.";

    // ── Slack ──────────────────────────────────────────────────────────────
    if !slack.is_empty() {
        print!(
            "  🔔 Slack:   {} ... ",
            slack.chars().take(40).collect::<String>().dimmed()
        );
        std::io::Write::flush(&mut std::io::stdout()).ok();

        let payload = serde_json::json!({
            "text": format!("*{}*\n{}", title, body),
        });

        match client.post(slack).json(&payload).send().await {
            Ok(resp) if resp.status().is_success() => {
                println!("{}", "✅ sent".green());
            }
            Ok(resp) => {
                println!("{} (HTTP {})", "❌ failed".red(), resp.status());
            }
            Err(e) => {
                println!("{}: {}", "❌ error".red(), e);
            }
        }
    }

    // ── Discord ────────────────────────────────────────────────────────────
    if !discord.is_empty() {
        print!("  🎮 Discord: configured ... ");
        std::io::Write::flush(&mut std::io::stdout()).ok();

        let payload = serde_json::json!({
            "content": format!("**{}**\n{}", title, body),
        });

        match client.post(discord).json(&payload).send().await {
            Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 204 => {
                println!("{}", "✅ sent".green());
            }
            Ok(resp) => {
                println!("{} (HTTP {})", "❌ failed".red(), resp.status());
            }
            Err(e) => {
                println!("{}: {}", "❌ error".red(), e);
            }
        }
    }

    // ── Telegram ───────────────────────────────────────────────────────────
    if !tg_token.is_empty() {
        print!("  📱 Telegram: chat {} ... ", tg_chat.dimmed());
        std::io::Write::flush(&mut std::io::stdout()).ok();

        if tg_chat.is_empty() {
            println!("{}", "⚠️  telegram_chat_id not set".yellow());
        } else {
            let url = format!("https://api.telegram.org/bot{}/sendMessage", tg_token);
            let payload = serde_json::json!({
                "chat_id": tg_chat,
                "text": format!("<b>{}</b>\n{}", title, body),
                "parse_mode": "HTML",
            });

            match client.post(&url).json(&payload).send().await {
                Ok(resp) if resp.status().is_success() => {
                    println!("{}", "✅ sent".green());
                }
                Ok(resp) => {
                    let txt = resp.text().await.unwrap_or_default();
                    println!(
                        "{}: {}",
                        "❌ failed".red(),
                        txt.chars().take(80).collect::<String>()
                    );
                }
                Err(e) => {
                    println!("{}: {}", "❌ error".red(), e);
                }
            }
        }
    }

    println!();
    println!(
        "  {} All channels tested. Check your apps!",
        "🎉".green().bold()
    );
    Ok(())
}
