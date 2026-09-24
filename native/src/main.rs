mod api;
mod chess;
mod engine;
mod hardware;
mod neural;
mod optimizer;
mod checkpoint;
mod training;
mod update;
mod provision;

use axum::Router;
use std::{path::{Path,PathBuf},sync::{Arc,Mutex},time::Duration};
use tower_http::services::ServeDir;

fn resolve_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("index.html").is_file() {
        return cwd;
    }

    let manifest_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Some(repo_root) = manifest_root.parent() {
        if repo_root.join("index.html").is_file() {
            return repo_root.to_path_buf();
        }
    }

    cwd
}

#[tokio::main]
async fn main(){
    let after_update=std::env::args().any(|a|a=="--after-update");
    let root=resolve_root();
    let state=api::AppState{root:root.clone(),training:Arc::new(Mutex::new(training::TrainingStatus::default())),stop:Arc::new(std::sync::atomic::AtomicBool::new(false)),pause:Arc::new(std::sync::atomic::AtomicBool::new(false)),trainer:Arc::new(Mutex::new(None))};
    if let Err(e)=provision::ensure_stockfish(&root){eprintln!("Stockfish provisioning unavailable: {e}");}
    let app:Router=api::router(state).fallback_service(ServeDir::new(root.clone()));
    let listener=tokio::net::TcpListener::bind(api::bind_addr()).await.expect("bind Chess Lab");
    tokio::spawn(async move{loop{
        tokio::time::sleep(Duration::from_secs(300)).await;
        match update::check_and_update().await{Ok(true)=>return,Ok(false)=>{},Err(e)=>eprintln!("automatic update check failed: {e}")}
    }});
    if after_update{eprintln!("Chess Lab restarted into the updated release.");}
    println!("Chess Lab Rust backend listening on http://127.0.0.1:8787/");
    println!("Chess Lab UI root: {}", root.display());
    axum::serve(listener,app).await.expect("Chess Lab server stopped");
}
