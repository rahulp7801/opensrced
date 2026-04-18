//! Handles `Commands::McpServer` — start MCP server for Claude/Antigravity integration.

use crate::cli::{create_github, create_memory, load_config};

pub async fn run_mcp_server(config_path: Option<&str>) -> anyhow::Result<()> {
    // MCP uses stdout for JSON-RPC — all human output goes to stderr
    eprintln!("🔌 ContribAI MCP server starting on stdio...");
    eprintln!("   Waiting for client connection...\n");

    let config = load_config(config_path)?;
    let github = create_github(&config)?;
    let memory = create_memory(&config)?;

    contribai::mcp::server::run_stdio_server(&github, &memory).await?;
    Ok(())
}
