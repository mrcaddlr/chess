use std::path::PathBuf;
use self_update::cargo_crate_version;

const OWNER: &str = "mrcaddlr";
const REPO: &str = "chess";
const BIN: &str = "chess-lab";

pub async fn check_and_update() -> Result<bool, String> {
    let updater = self_update::backends::github::Update::configure()
        .repo_owner(OWNER)
        .repo_name(REPO)
        .bin_name(BIN)
        .current_version(cargo_crate_version!())
        .show_output(false)
        .no_confirm(true)
        .build()
        .map_err(|e| format!("update configuration failed: {e}"))?;

    let available = updater
        .is_update_available()
        .map_err(|e| format!("update check failed: {e}"))?;

    if available.is_none() {
        return Ok(false);
    }

    updater
        .update()
        .map_err(|e| format!("update install failed: {e}"))?;

    let mut args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == "--after-update") {
        args.push("--after-update".into());
    }

    self_update::restart::restart_with(args)
        .map_err(|e| format!("updated binary could not restart: {e}"))?;

    Ok(true)
}

pub fn install_root() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
}
