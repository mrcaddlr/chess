use axum::{extract::State,routing::{get,post},Json,Router};
use serde::Serialize;
use serde_json::Value;
use std::{path::PathBuf,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},thread,time::Duration};
use crate::{checkpoint,engine,hardware,training::{Trainer,TrainingStatus}};

#[derive(Clone)]
pub struct AppState{
 pub root:PathBuf,
 pub training:Arc<Mutex<TrainingStatus>>,
 pub stop:Arc<AtomicBool>,
 pub pause:Arc<AtomicBool>,
 pub trainer:Arc<Mutex<Option<Trainer>>>,
}

#[derive(Serialize)]
struct Health{ok:bool,service:&'static str,version:&'static str,backend:&'static str}

pub fn router(state:AppState)->Router{
 Router::new()
 .route("/api/health",get(health))
 .route("/api/status",get(status))
 .route("/api/hardware",get(hw))
 .route("/api/engines",get(engines))
 .route("/api/training/start",post(start_training))
 .route("/api/training/stop",post(stop_training))
 .route("/api/training/pause",post(pause_training))
 .route("/api/training/resume",post(resume_training))
 .route("/api/training/checkpoint",post(checkpoint_training))
 .route("/api/training/status",get(training_status))
 .with_state(Arc::new(state))
}

async fn health()->Json<Health>{Json(Health{ok:true,service:"chess-lab",version:env!("CARGO_PKG_VERSION"),backend:"rust"})}

async fn status(State(s):State<Arc<AppState>>)->Json<Value>{
 let training=s.training.lock().map(|v|v.clone()).unwrap_or_default();
 Json(serde_json::json!({"ok":true,"backend":"rust","version":env!("CARGO_PKG_VERSION"),"trainingAvailable":true,"nativeCompute":true,"training":training,"engines":engine::list(&s.root),"hardware":hardware::detect()}))
}
async fn hw()->Json<hardware::HardwareInfo>{Json(hardware::detect())}
async fn engines(State(s):State<Arc<AppState>>)->Json<Vec<engine::EngineInfo>>{Json(engine::list(&s.root))}
async fn training_status(State(s):State<Arc<AppState>>)->Json<TrainingStatus>{Json(s.training.lock().map(|v|v.clone()).unwrap_or_default())}

fn set_status(s:&AppState,f:impl FnOnce(&mut TrainingStatus)){if let Ok(mut x)=s.training.lock(){f(&mut x);}}

async fn start_training(State(s):State<Arc<AppState>>,Json(body):Json<Value>)->Json<Value>{
 if s.training.lock().map(|x|x.running).unwrap_or(false){return Json(serde_json::json!({"ok":false,"started":false,"reason":"already-running"}));}
 let games=body.get("games").and_then(Value::as_u64).unwrap_or(4).max(1).min(64);
 let max_generations=body.get("generations").and_then(Value::as_u64).unwrap_or(0);
 s.stop.store(false,Ordering::SeqCst);s.pause.store(false,Ordering::SeqCst);
 set_status(&s,|x|{x.running=true;x.paused=false;x.last_error=None;});
 let state=s.clone();
 thread::spawn(move||{
   let checkpoint_path=state.root.join(".chess-lab").join("training.ckpt");
   if let Some(parent)=checkpoint_path.parent(){let _=std::fs::create_dir_all(parent);}
   let mut trainer=Trainer::new();
   let mut generation=0u64;
   if checkpoint_path.exists(){if let Ok(g)=checkpoint::load(&checkpoint_path,&mut trainer.network,&mut trainer.optimizer){generation=g;}}
   let mut total_games=0u64;
   let mut total_positions=0u64;
   while !state.stop.load(Ordering::SeqCst) && (max_generations==0 || generation<max_generations){
     while state.pause.load(Ordering::SeqCst) && !state.stop.load(Ordering::SeqCst){
       set_status(&state,|x|x.paused=true);thread::sleep(Duration::from_millis(250));
     }
     if state.stop.load(Ordering::SeqCst){break;}
     set_status(&state,|x|x.paused=false);
     let mut positions=0usize;
     for _ in 0..games{
       if state.stop.load(Ordering::SeqCst){break;}
       while state.pause.load(Ordering::SeqCst) && !state.stop.load(Ordering::SeqCst){set_status(&state,|x|x.paused=true);thread::sleep(Duration::from_millis(250));}
       if state.stop.load(Ordering::SeqCst){break;}
       positions+=trainer.self_play_game(200);
     }
     if state.stop.load(Ordering::SeqCst){break;}
     let loss=trainer.train_steps(games as usize,32);
     generation+=1;total_games+=games;total_positions+=positions as u64;
     if let Err(e)=checkpoint::save(&checkpoint_path,&trainer.network,generation,&trainer.optimizer){
       set_status(&state,|x|x.last_error=Some(format!("checkpoint: {e}")));
     }
     set_status(&state,|x|{x.running=true;x.paused=false;x.generation=generation;x.games=total_games;x.positions=total_positions;x.loss=loss.total;x.policy_loss=loss.policy;x.value_loss=loss.value;x.replay_size=trainer.replay.len();x.optimizer_step=trainer.optimizer.step;});
   }
   if let Ok(mut slot)=state.trainer.lock(){*slot=Some(trainer);}
   set_status(&state,|x|{x.running=false;x.paused=false;});
 });
 Json(serde_json::json!({"ok":true,"started":true,"games":games,"generations":max_generations}))
}

async fn stop_training(State(s):State<Arc<AppState>>)->Json<Value>{
 s.stop.store(true,Ordering::SeqCst);s.pause.store(false,Ordering::SeqCst);
 Json(serde_json::json!({"ok":true,"stopping":true}))
}
async fn pause_training(State(s):State<Arc<AppState>>)->Json<Value>{s.pause.store(true,Ordering::SeqCst);Json(serde_json::json!({"ok":true,"paused":true}))}
async fn resume_training(State(s):State<Arc<AppState>>)->Json<Value>{s.pause.store(false,Ordering::SeqCst);Json(serde_json::json!({"ok":true,"paused":false}))}

async fn checkpoint_training(State(s):State<Arc<AppState>>)->Json<Value>{
 let path=s.root.join(".chess-lab").join("training.ckpt");
 let result=if let Ok(slot)=s.trainer.lock(){if let Some(t)=slot.as_ref(){std::fs::create_dir_all(path.parent().unwrap()).ok();checkpoint::save(&path,&t.network,t.optimizer.step,&t.optimizer).map(|_|()).map_err(|e|e.to_string())}else{Err("training has not finished a generation yet".into())}}else{Err("training state unavailable".into())};
 match result{Ok(())=>Json(serde_json::json!({"ok":true,"path":".chess-lab/training.ckpt"})),Err(e)=>Json(serde_json::json!({"ok":false,"error":e}))}
}
