use axum::{extract::State,routing::{get,post},Json,Router};
use serde::Serialize;
use std::{path::PathBuf,sync::{Arc,Mutex}};
use crate::{engine,hardware,training::{Trainer,TrainingStatus}};

#[derive(Clone)]
pub struct AppState{pub root:PathBuf,pub training:Arc<Mutex<TrainingStatus>>}

#[derive(Serialize)]
struct Health{ok:bool,service:&'static str,version:&'static str,backend:&'static str}

pub fn router(state:AppState)->Router{
 Router::new()
 .route("/api/health",get(health))
 .route("/api/status",get(status))
 .route("/api/hardware",get(hw))
 .route("/api/engines",get(engines))
 .route("/api/training/start",post(start_training))
 .route("/api/training/status",get(training_status))
 .with_state(Arc::new(state))
}

async fn health()->Json<Health>{Json(Health{ok:true,service:"chess-lab",version:env!("CARGO_PKG_VERSION"),backend:"rust"})}

async fn status(State(s):State<Arc<AppState>>)->Json<serde_json::Value>{
 let training=s.training.lock().map(|v|v.clone()).unwrap_or_default();
 Json(serde_json::json!({"ok":true,"backend":"rust","version":env!("CARGO_PKG_VERSION"),"trainingAvailable":true,"training":training,"engines":engine::list(&s.root),"hardware":hardware::detect()}))
}

async fn hw()->Json<hardware::HardwareInfo>{Json(hardware::detect())}
async fn engines(State(s):State<Arc<AppState>>)->Json<Vec<engine::EngineInfo>>{Json(engine::list(&s.root))}
async fn training_status(State(s):State<Arc<AppState>>)->Json<TrainingStatus>{Json(s.training.lock().map(|v|v.clone()).unwrap_or_default())}

async fn start_training(State(s):State<Arc<AppState>>)->Json<serde_json::Value>{
 if let Ok(mut status)=s.training.lock(){
   if status.running{return Json(serde_json::json!({"ok":false,"started":false,"reason":"already-running"}));}
   status.running=true;status.paused=false;
 }
 let training=s.training.clone();
 let root=s.root.clone();
 std::thread::spawn(move||{
   let mut trainer=Trainer::new();
   let result=trainer.run(1);
   if let Ok(mut status)=training.lock(){*status=result;}
   let _=root;
 });
 Json(serde_json::json!({"ok":true,"started":true}))
}
