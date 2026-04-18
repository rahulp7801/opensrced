//! Handles `Commands::WebServer` — start the web dashboard API server.

use colored::Colorize;

use crate::cli::{create_memory, load_config, print_banner};

pub async fn run_web_server(
    config_path: Option<&str>,
    host: String,
    port: u16,
) -> anyhow::Result<()> {
    print_banner();
    println!(
        "  🌐 Starting web dashboard on {}:{}",
        host.cyan(),
        port.to_string().cyan()
    );
    println!("  Open http://{}:{} in your browser\n", host, port);
    let config = load_config(config_path)?;
    let memory = create_memory(&config)?;
    contribai::web::run_server(memory, &config, &host, port)
        .await
        .map_err(|e| anyhow::anyhow!("{}", e))
}
