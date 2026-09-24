use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use crate::{engine, hardware};

#[derive(Clone)]
pub struct AppState {
    pub root: PathBuf,
}

#[derive(Serialize)]
struct Health {
    ok: bool,
    service: &'static str,
    version: &'static str,
    backend: &'static str,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/status", get(status))
        .route("/api/hardware", get(hw))
        .route("/api/engines", get(engines))
        .with_state(Arc::new(state))
}

async fn health() -> Json<Health> {
    Json(Health { ok: true, service: "chess-lab", version: env!("CARGO_PKG_VERSION"), backend: "rust" })
}

async fn status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let engines = engine::list(&state.root);
    Json(serde_json::json!({
        "ok": true,
        "backend": "rust",
        "version": env!("CARGO_PKG_VERSION"),
        "trainingAvailable": true,
        "engines": engines,
        "hardware": hardware::detect()
    }))
}

async fn hw() -> Json<hardware::HardwareInfo> {
    Json(hardware::detect())
}

async fn engines(State(state): State<Arc<AppState>>) -> Json<Vec<engine::EngineInfo>> {
    Json(engine::list(&state.root))
}

pub fn bind_addr() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 8787))
}
