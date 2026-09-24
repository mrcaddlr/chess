use axum::{extract::State,routing::{get,post},Json,Router};
use serde::Serialize;
use std::{path::PathBuf,sync::Arc};
use crate::{engine,hardware,training::Trainer};

#[derive(Clone)] pub struct AppState{pub root:PathBuf}
#[derive(Serialize)] struct Health{ok:bool,service:&'static str,version:&'static str,backend:&'static str}

pub fn router(state:AppState)->Router{
 Router::new().route("/api/health",get(health)).route("/api/status",get(status))
 .route("/api/hardware",get(hw)).route("/api/engines",get(engines)).route("/api/training/start",post(start_training))
 .with_state(Arc::new(state))
}
async fn health()->Json<Health>{Json(Health{ok:true,service:"chess-lab",version:env!("CARGO_PKG_VERSION"),backend:"rust"})}
async fn status(State(s):State<Arc<AppState>>)->Json<serde_json::Value>{Json(serde_json::json!({"ok":true,"backend":"rust","version":env!("CARGO_PKG_VERSION"),"trainingAvailable":true,"engines":engine::list(&s.root),"hardware":hardware::detect()}))}
async fn hw()->Json<hardware::HardwareInfo>{Json(hardware::detect())}
async fn engines(State(s):State<Arc<AppState>>)->Json<Vec<engine::EngineInfo>>{Json(engine::list(&s.root))}
async fn start_training()->Json<serde_json::Value>{
 let trainer=Trainer::new();
 std::thread::spawn(move||{let _=trainer.run(1);});
 Json(serde_json::json!({"ok":true,"started":true}))
}
