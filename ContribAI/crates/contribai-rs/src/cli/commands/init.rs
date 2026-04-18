//! Handles `Commands::Init` — interactive setup wizard.

use crate::cli::wizard;

pub fn run_init(_config_path: Option<&str>, output: Option<String>) -> anyhow::Result<()> {
    let out_path = output.as_deref().map(std::path::Path::new);
    if let Some(result) = wizard::run_init_wizard(out_path)? {
        wizard::write_wizard_config(&result)?;
    }
    Ok(())
}
