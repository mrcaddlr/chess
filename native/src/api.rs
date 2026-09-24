use axum::{extract::State,routing::{get,post},Json,Router};
use serde_json::Value;
use std::{path::PathBuf,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},thread,time::Duration};
use crate::{checkpoint,engine,hardware,provision,training::{self,Trainer,TrainingStatus}};

#[derive(Clone)]
pub struct AppState{pub root:PathBuf,pub training:Arc<Mutex<TrainingStatus>>,pub stop:Arc<AtomicBool>,pub pause:Arc<AtomicBool>,pub trainer:Arc<Mutex<Option<Trainer>>>}

pub fn router(state:AppState)->Router{
 Router::new().route("/api/health",get(health)).route("/api/status",get(status)).route("/api/hardware",get(hw))
 .route("/api/engines",get(engines)).route("/api/engine-move",post(engine_move))
 .route("/api/training/start",post(start_training)).route("/api/training/stop",post(stop_training))
 .route("/api/training/pause",post(pause_training)).route("/api/training/resume",post(resume_training))
 .route("/api/training/checkpoint",post(checkpoint_training)).route("/api/training/status",get(training_status))
 .with_state(Arc::new(state))
}
async fn health()->Json<Value>{Json(serde_json::json!({"ok":true,"service":"chess-lab","version":env!("CARGO_PKG_VERSION"),"backend":"rust"}))}
async fn status(State(s):State<Arc<AppState>>)->Json<Value>{
 let t=s.training.lock().map(|x|x.clone()).unwrap_or_default();
 let engines=engine::list(&s.root);
 let stockfish=engines.iter().find(|e|e.id=="sf19-full-single");
 Json(serde_json::json!({"ok":true,"backend":"rust","version":env!("CARGO_PKG_VERSION"),"trainingAvailable":true,"nativeCompute":true,"training":t,
 "engines":engines,"stockfishInfo":{"available":stockfish.map(|e|e.installed&&e.healthy).unwrap_or(false),"installed":stockfish.map(|e|e.installed).unwrap_or(false)}}))
}
async fn hw()->Json<hardware::HardwareInfo>{Json(hardware::detect())}
async fn engines(State(s):State<Arc<AppState>>)->Json<Vec<engine::EngineInfo>>{Json(engine::list(&s.root))}
#[derive(serde::Deserialize,Default)]struct EngineMoveRequest{fen:String,depth:Option<u8>,allowedMoves:Option<Vec<String>>,engine:Option<String>,threads:Option<u32>}
async fn engine_move(State(s):State<Arc<AppState>>,Json(req):Json<EngineMoveRequest>)->Json<Value>{
 let root=s.root.clone();let result=tokio::task::spawn_blocking(move||engine::best_move(&root,req.engine.as_deref().unwrap_or(engine::default_engine_id()),&req.fen,req.depth.unwrap_or(12),req.allowedMoves.as_deref().unwrap_or(&[]),req.threads.unwrap_or(1))).await;
 match result{Ok(Ok(mv))=>Json(serde_json::json!({"ok":true,"move":mv})),Ok(Err(e))=>Json(serde_json::json!({"ok":false,"error":e})),Err(e)=>Json(serde_json::json!({"ok":false,"error":format!("engine worker failed: {e}")}))}
}
async fn training_status(State(s):State<Arc<AppState>>)->Json<TrainingStatus>{Json(s.training.lock().map(|v|v.clone()).unwrap_or_default())}
fn set_status(s:&AppState,f:impl FnOnce(&mut TrainingStatus)){if let Ok(mut x)=s.training.lock(){f(&mut x)}}

async fn start_training(State(s):State<Arc<AppState>>,Json(body):Json<Value>)->Json<Value>{
 if s.training.lock().map(|x|x.running).unwrap_or(false){return Json(serde_json::json!({"ok":false,"started":false,"reason":"already-running"}))}
 if let Err(e)=provision::ensure_stockfish(&s.root){set_status(&s,|x|x.last_error=Some(format!("Stockfish provisioning: {e}")));return Json(serde_json::json!({"ok":false,"started":false,"error":e}))}
 let games=body.get("games").and_then(Value::as_u64).unwrap_or(4).clamp(1,64);
 let generations=body.get("generations").and_then(Value::as_u64).unwrap_or(1).clamp(1,1000000);
 let max_plies=body.get("maxPlies").and_then(Value::as_u64).unwrap_or(200).clamp(20,2000)as usize;
 let simulations=body.get("simulations").and_then(Value::as_u64).unwrap_or(32).clamp(1,512)as usize;
 let updates=body.get("updates").and_then(Value::as_u64).unwrap_or(games*8).clamp(1,100000)as usize;
 let batch=body.get("batch").and_then(Value::as_u64).unwrap_or(32).clamp(1,1024)as usize;
 let eval_games=body.get("evalGames").and_then(Value::as_u64).unwrap_or(4).clamp(2,100);
 let eval_plies=body.get("evalPlies").and_then(Value::as_u64).unwrap_or(200).clamp(20,2000)as usize;
 let depth=body.get("stockfishDepth").and_then(Value::as_u64).unwrap_or(10).clamp(1,30)as u8;
 let threads=body.get("stockfishThreads").and_then(Value::as_u64).unwrap_or(1).clamp(1,64)as u32;
 let replay_capacity=body.get("replay").and_then(Value::as_u64).unwrap_or(100000).clamp(1000,500000)as usize;
 s.stop.store(false,Ordering::SeqCst);s.pause.store(false,Ordering::SeqCst);
 set_status(&s,|x|{*x=TrainingStatus::default();x.running=true;x.phase="starting".into();});
 let state=s.clone();
 thread::spawn(move||{
  let dir=state.root.join(".chess-lab");let _=std::fs::create_dir_all(&dir);
  let generation_path=dir.join("generation.ckpt");let champion_path=dir.join("champion.ckpt");let replay_path=dir.join("replay.json");
  let mut trainer=Trainer::new();trainer.replay.capacity=replay_capacity;
  let mut generation=0u64;
  if generation_path.exists(){if let Ok(g)=checkpoint::load(&generation_path,&mut trainer.network,&mut trainer.optimizer){generation=g;}}
  if replay_path.exists(){if let Ok(r)=training::ReplayBuffer::load(&replay_path,replay_capacity){trainer.replay=r;}}
  let mut total_games=0u64;let mut total_positions=0u64;let mut champion_score=0.0;let mut champion_generation=0u64;
  if champion_path.exists(){let mut n=trainer.network.clone();let mut o=trainer.optimizer.clone();if let Ok(g)=checkpoint::load(&champion_path,&mut n,&mut o){champion_generation=g;}}
  while !state.stop.load(Ordering::SeqCst)&&generation<generations{
   while state.pause.load(Ordering::SeqCst)&&!state.stop.load(Ordering::SeqCst){set_status(&state,|x|{x.paused=true;x.phase="paused".into()});thread::sleep(Duration::from_millis(200));}
   if state.stop.load(Ordering::SeqCst){break}
   set_status(&state,|x|{x.paused=false;x.phase="self-play".into()});
   let mut gen_positions=0usize;
   for _ in 0..games{
    if state.stop.load(Ordering::SeqCst){break}
    while state.pause.load(Ordering::SeqCst)&&!state.stop.load(Ordering::SeqCst){set_status(&state,|x|x.paused=true);thread::sleep(Duration::from_millis(200));}
    if state.stop.load(Ordering::SeqCst){break}
    gen_positions+=trainer.self_play_game(max_plies,simulations);
    set_status(&state,|x|{x.games=total_games+1;x.positions=total_positions+gen_positions as u64;x.replay_size=trainer.replay.len();x.phase="self-play".into();});
    total_games+=1;
   }
   if state.stop.load(Ordering::SeqCst){break}
   set_status(&state,|x|x.phase="training".into());
   let loss=trainer.train_steps(updates,batch);
   generation+=1;total_positions+=gen_positions as u64;
   let _=checkpoint::save(&generation_path,&trainer.network,generation,&trainer.optimizer);
   let _=trainer.replay.save(&replay_path);
   set_status(&state,|x|{x.generation=generation;x.games=total_games;x.positions=total_positions;x.loss=loss.total;x.policy_loss=loss.policy;x.value_loss=loss.value;x.replay_size=trainer.replay.len();x.optimizer_step=trainer.optimizer.step;});
   set_status(&state,|x|x.phase="evaluating".into());
   match training::evaluate_network(&state.root,&trainer.network,generation,eval_games,eval_plies,depth,threads){
    Ok(eval)=>{
     let promoted=!champion_path.exists()||eval.score>champion_score+0.01;
     if promoted{
      if let Err(e)=checkpoint::save(&champion_path,&trainer.network,generation,&trainer.optimizer){set_status(&state,|x|x.last_error=Some(format!("champion checkpoint: {e}")))}else{champion_score=eval.score;champion_generation=generation;}
     }
     set_status(&state,|x|{x.evaluation_games=eval.games;x.evaluation_wins=eval.wins;x.evaluation_draws=eval.draws;x.evaluation_losses=eval.losses;x.evaluation_score=eval.score;x.champion_generation=champion_generation;x.champion_score=champion_score;x.phase=if promoted{"promoted".into()}else{"complete".into()};});
    }
    Err(e)=>set_status(&state,|x|{x.last_error=Some(format!("Stockfish evaluation: {e}"));x.phase="evaluation-error".into();}),
   }
   let _=trainer.replay.save(&replay_path);
  }
  if let Ok(mut slot)=state.trainer.lock(){*slot=Some(trainer);}
  set_status(&state,|x|{x.running=false;x.paused=false;if x.phase=="self-play"||x.phase=="training"{x.phase="stopped".into()}});
 });
 Json(serde_json::json!({"ok":true,"started":true,"gamesPerGeneration":games,"generations":generations,"evaluation":"stockfish-19","checkpoint":".chess-lab/generation.ckpt","champion":".chess-lab/champion.ckpt"}))
}

async fn stop_training(State(s):State<Arc<AppState>>)->Json<Value>{s.stop.store(true,Ordering::SeqCst);s.pause.store(false,Ordering::SeqCst);Json(serde_json::json!({"ok":true,"stopping":true}))}
async fn pause_training(State(s):State<Arc<AppState>>)->Json<Value>{s.pause.store(true,Ordering::SeqCst);Json(serde_json::json!({"ok":true,"paused":true}))}
async fn resume_training(State(s):State<Arc<AppState>>)->Json<Value>{s.pause.store(false,Ordering::SeqCst);Json(serde_json::json!({"ok":true,"paused":false}))}
async fn checkpoint_training(State(s):State<Arc<AppState>>)->Json<Value>{
 let dir=s.root.join(".chess-lab");let _=std::fs::create_dir_all(&dir);let path=dir.join("manual.ckpt");
 let result=if let Ok(slot)=s.trainer.lock(){if let Some(t)=slot.as_ref(){checkpoint::save(&path,&t.network,t.optimizer.step,&t.optimizer).map_err(|e|e.to_string())}else{Err("training has not produced a trainer state yet".into())}}else{Err("training state unavailable".into())};
 match result{Ok(())=>Json(serde_json::json!({"ok":true,"path":".chess-lab/manual.ckpt"})),Err(e)=>Json(serde_json::json!({"ok":false,"error":e}))}
}
