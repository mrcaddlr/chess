use crate::{chess::{Board,Move},engine::{self,EngineSession},neural::{Network,Gradients},optimizer::{Optimizer,LossStats}};
use serde::{Deserialize,Serialize};
use std::{collections::HashMap,fs,path::Path};

#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct PositionSample{pub board:Board,pub policy:Vec<(Move,f32)>,pub value:f32,pub priority:f32}

#[derive(Serialize,Deserialize)]
struct ReplayDisk{magic:String,version:u32,capacity:usize,seed:u64,samples:Vec<PositionSample>}

#[derive(Default)]
pub struct ReplayBuffer{capacity:usize,samples:Vec<PositionSample>,seed:u64}
impl ReplayBuffer{
 pub fn new(capacity:usize)->Self{Self{capacity:capacity.max(1),samples:Vec::new(),seed:0x517cc1b727220a95}}
 pub fn len(&self)->usize{self.samples.len()}
 pub fn push(&mut self,mut sample:PositionSample){sample.priority=sample.priority.max(1e-3);if self.samples.len()>=self.capacity{self.samples.remove(0);}self.samples.push(sample);}
 pub fn recent(&self,count:usize)->&[PositionSample]{let start=self.samples.len().saturating_sub(count);&self.samples[start..]}
 pub fn all(&self)->&[PositionSample]{&self.samples}
 fn random_unit(&mut self)->f32{self.seed^=self.seed<<13;self.seed^=self.seed>>7;self.seed^=self.seed<<17;(self.seed as f64/u64::MAX as f64)as f32}
 pub fn sample_indices(&mut self,count:usize)->Vec<usize>{
  let n=self.samples.len();if n==0{return Vec::new();}let take=count.min(n);let mut out=Vec::with_capacity(take);
  let recent_count=(take/4).max(1).min(n);for i in n-recent_count..n{out.push(i);}
  while out.len()<take{
   let total:f32=self.samples.iter().map(|s|s.priority.max(1e-3)).sum();let mut r=self.random_unit()*total;let mut chosen=0;
   for(i,s)in self.samples.iter().enumerate(){r-=s.priority.max(1e-3);if r<=0.0{chosen=i;break;}}
   if !out.contains(&chosen){out.push(chosen)}else{let fallback=(self.random_unit()*n as f32)as usize;if !out.contains(&fallback){out.push(fallback);}}
  }out
 }
 pub fn update_priorities(&mut self,indices:&[usize],losses:&[f32]){for(&i,&loss)in indices.iter().zip(losses.iter()){if let Some(s)=self.samples.get_mut(i){s.priority=(loss.abs()+0.05).min(10.0);}}}
 pub fn save(&self,path:&Path)->Result<(),String>{
  let disk=ReplayDisk{magic:"CHESSLAB-REPLAY".into(),version:1,capacity:self.capacity,seed:self.seed,samples:self.samples.clone()};
  let data=serde_json::to_vec(&disk).map_err(|e|format!("serialize replay: {e}"))?;let tmp=path.with_extension("tmp");
  fs::write(&tmp,data).map_err(|e|format!("write replay: {e}"))?;fs::rename(tmp,path).map_err(|e|format!("activate replay: {e}"))
 }
 pub fn load(path:&Path,capacity:usize)->Result<Self,String>{
  let data=fs::read(path).map_err(|e|e.to_string())?;let disk:ReplayDisk=serde_json::from_slice(&data).map_err(|e|format!("parse replay: {e}"))?;
  if disk.magic!="CHESSLAB-REPLAY"||disk.version!=1{return Err("unsupported replay format".into())}
  let mut r=Self::new(capacity.max(disk.capacity));r.seed=disk.seed;r.samples=disk.samples;
  if r.samples.len()>r.capacity{let keep=r.capacity;r.samples.drain(0..r.samples.len()-keep);}Ok(r)
 }
}

#[derive(Clone,Debug)]pub struct SearchNode{pub visits:u32,pub value_sum:f32,pub prior:f32,pub children:HashMap<Move,usize>,pub mv:Option<Move>,pub expanded:bool}

pub struct Mcts{pub nodes:Vec<SearchNode>,pub exploration:f32,seed:u64,transpositions:HashMap<String,usize>}
impl Mcts{
 pub fn new()->Self{Self{nodes:Vec::with_capacity(4096),exploration:1.35,seed:0x9e3779b97f4a7c15,transpositions:HashMap::with_capacity(8192)}}
 fn random_unit(&mut self)->f32{self.seed^=self.seed<<13;self.seed^=self.seed>>7;self.seed^=self.seed<<17;(self.seed as f64/u64::MAX as f64)as f32}
 fn expand(&mut self,idx:usize,board:&Board,network:&Network)->f32{
  let legal=board.legal_moves();if legal.is_empty(){return if board.in_check(board.white_to_move){-1.0}else{0.0};}
  let(priors,value)=network.infer(board);let mut sum=0.0;
  for mv in &legal{sum+=priors[Network::move_index(*mv)].max(1e-6);}
  for mv in legal{
   let mut next=*board;let _=next.make(mv);let key=next.position_key();
   let child=if let Some(&existing)=self.transpositions.get(&key){existing}else{
    let i=self.nodes.len();self.nodes.push(SearchNode{visits:0,value_sum:0.0,prior:priors[Network::move_index(mv)].max(1e-6)/sum,children:HashMap::new(),mv:Some(mv),expanded:false});self.transpositions.insert(key,i);i
   };
   self.nodes[idx].children.insert(mv,child);
  }
  self.nodes[idx].expanded=true;value
 }
 fn simulate(&mut self,idx:usize,board:Board,network:&Network,depth:usize)->f32{
  if depth>=256{return 0.0}
  if board.legal_moves().is_empty(){return if board.in_check(board.white_to_move){-1.0}else{0.0}}
  if !self.nodes[idx].expanded{let value=self.expand(idx,&board,network);self.nodes[idx].visits+=1;self.nodes[idx].value_sum+=value;return value}
  let parent=(self.nodes[idx].visits.max(1)as f32).sqrt();let mut best=None;let mut score=f32::NEG_INFINITY;
  for(mv,&ci)in &self.nodes[idx].children{let n=&self.nodes[ci];let q=if n.visits==0{0.0}else{n.value_sum/n.visits as f32};let u=self.exploration*n.prior*parent/(1.0+n.visits as f32);let s=q+u;if s>score{score=s;best=Some((*mv,ci));}}
  let(mv,ci)=best.unwrap();let mut next=board;let _=next.make(mv);let value=-self.simulate(ci,next,network,depth+1);
  self.nodes[idx].visits+=1;self.nodes[idx].value_sum+=value;value
 }
 pub fn search_with_policy(&mut self,board:&Board,network:&Network,simulations:usize,add_noise:bool)->(Option<Move>,Vec<(Move,f32)>){
  let legal=board.legal_moves();if legal.is_empty(){return(None,Vec::new())}
  self.nodes.clear();self.transpositions.clear();self.nodes.push(SearchNode{visits:0,value_sum:0.0,prior:1.0,children:HashMap::with_capacity(64),mv:None,expanded:false});
  let _=self.expand(0,board,network);
  if add_noise{
   let alpha=0.30;let epsilon=0.25;let mut raw=Vec::with_capacity(legal.len());let mut sum=0.0;
   for _ in &legal{let n=self.random_unit().max(1e-6).powf(1.0/alpha);raw.push(n);sum+=n;}
   for(mv,n)in legal.iter().zip(raw){if let Some(&i)=self.nodes[0].children.get(mv){let old=self.nodes[i].prior;self.nodes[i].prior=(1.0-epsilon)*old+epsilon*n/sum.max(1e-9);}}
  }
  for _ in 0..simulations.max(1){let _=self.simulate(0,*board,network,0);}
  let total=self.nodes[0].children.values().map(|&i|self.nodes[i].visits as f32).sum::<f32>().max(1.0);
  let mut policy=legal.iter().map(|mv|{let i=self.nodes[0].children[mv];(*mv,self.nodes[i].visits as f32/total)}).collect::<Vec<_>>();
  policy.sort_by(|a,b|b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));(policy.first().map(|x|x.0),policy)
 }
 pub fn search(&mut self,board:&Board,network:&Network,simulations:usize)->Option<Move>{self.search_with_policy(board,network,simulations,false).0}
}

#[derive(Clone,Copy,Debug,PartialEq,Eq)]pub enum GameResult{WhiteWin,BlackWin,Draw}
impl GameResult{pub fn value_for(&self,white:bool)->f32{match self{Self::WhiteWin=>if white{1.0}else{-1.0},Self::BlackWin=>if white{-1.0}else{1.0},Self::Draw=>0.0}}}

pub fn adjudicate(board:&Board,history:&HashMap<String,u32>,automatic_repetition:bool)->Option<GameResult>{
 let legal=board.legal_moves();if legal.is_empty(){return if board.in_check(board.white_to_move){Some(if board.white_to_move{GameResult::BlackWin}else{GameResult::WhiteWin})}else{Some(GameResult::Draw)}}
 if board.insufficient_material()||board.halfmove>=150{return Some(GameResult::Draw)}
 if automatic_repetition&&history.get(&board.position_key()).copied().unwrap_or(0)>=5{return Some(GameResult::Draw)}None
}

#[derive(Clone,Serialize,Default)]pub struct TrainingStatus{
 pub running:bool,pub paused:bool,pub phase:String,pub generation:u64,pub games:u64,pub positions:u64,
 pub loss:f32,pub policy_loss:f32,pub value_loss:f32,pub replay_size:usize,pub optimizer_step:u64,
 pub evaluation_games:u64,pub evaluation_wins:u64,pub evaluation_draws:u64,pub evaluation_losses:u64,
 pub evaluation_score:f32,pub champion_generation:u64,pub champion_score:f32,pub last_error:Option<String>,
}
pub struct Trainer{pub replay:ReplayBuffer,pub mcts:Mcts,pub network:Network,pub optimizer:Optimizer}

impl Trainer{
 pub fn new()->Self{Self{replay:ReplayBuffer::new(100_000),mcts:Mcts::new(),network:Network::new(),optimizer:Optimizer::new(0.001)}}
 pub fn self_play_game(&mut self,max_plies:usize,simulations:usize)->usize{
  let mut board=Board::default();let mut positions=Vec::new();let mut history=HashMap::new();*history.entry(board.position_key()).or_insert(0)+=1;let mut result=None;
  for ply in 0..max_plies{
   if let Some(r)=adjudicate(&board,&history,true){result=Some(r);break}
   let legal=board.legal_moves();if legal.is_empty(){break}
   let(_,policy)=self.mcts.search_with_policy(&board,&self.network,simulations.max(1),true);
   let temperature=if ply<12{1.0}else if ply<32{0.5}else{0.15};
   let mv=if temperature<=0.15{policy.first().map(|x|x.0)}else{let weights:Vec<(Move,f32)>=policy.iter().map(|(m,p)|(*m,p.max(1e-6).powf(1.0/temperature))).collect();let sum:f32=weights.iter().map(|x|x.1).sum();let mut r=self.mcts.random_unit()*sum;let mut chosen=None;for(m,w)in weights{r-=w;if r<=0.0{chosen=Some(m);break}}chosen.or_else(||policy.first().map(|x|x.0))};
   let mv=mv.filter(|m|legal.contains(m)).unwrap_or(legal[0]);positions.push((board,policy));if board.make(mv).is_err(){break}*history.entry(board.position_key()).or_insert(0)+=1;
  }
  let position_count=positions.len();let result=result.unwrap_or(GameResult::Draw);for(board,policy)in positions{let entropy=policy.iter().map(|(_,p)|{let q=p.max(1e-9);-q*q.ln()}).sum::<f32>();self.replay.push(PositionSample{board,policy,value:result.value_for(board.white_to_move),priority:0.25+entropy});}
  position_count
 }
 pub fn train_steps(&mut self,steps:usize,batch:usize)->LossStats{
  let mut last=LossStats::default();if self.replay.len()==0{return last}
  for _ in 0..steps.max(1){let indices=self.replay.sample_indices(batch.max(1));let mut total=Gradients::zero();let mut losses=Vec::with_capacity(indices.len());
   for &i in &indices{let s=&self.replay.all()[i];let g=self.network.gradients(&s.board,&s.policy,s.value);losses.push(g.policy_loss+g.value_loss);total.add(&g)}
   self.optimizer.update_gradients(&mut self.network,&total);self.replay.update_priorities(&indices,&losses);last=LossStats::from_gradients(&total);
  }last
 }
 pub fn run(&mut self,games:u64)->TrainingStatus{for _ in 0..games{self.self_play_game(200,32);}let l=self.train_steps(games as usize,32);TrainingStatus{running:false,generation:1,games,positions:self.replay.len()as u64,loss:l.total,policy_loss:l.policy,value_loss:l.value,replay_size:self.replay.len(),optimizer_step:self.optimizer.step,..Default::default()}}
}

fn square(i:u8)->String{format!("{}{}",(b'a'+i%8)as char,(b'8'-i/8)as char)}
fn move_uci(m:Move)->String{format!("{}{}{}",square(m.from),square(m.to),m.promotion.map(|p|p.to_ascii_lowercase()).unwrap_or_default())}
fn fen(board:&Board)->String{
 let mut ranks=Vec::new();for r in 0..8{let mut s=String::new();let mut empty=0;for f in 0..8{let p=board.squares[r*8+f];if p=='.'{empty+=1}else{if empty>0{s.push(char::from(b'0'+empty));empty=0}s.push(p)}}if empty>0{s.push(char::from(b'0'+empty))}ranks.push(s)}
 let mut cast=String::new();if board.castling&1!=0{cast.push('K')}if board.castling&2!=0{cast.push('Q')}if board.castling&4!=0{cast.push('k')}if board.castling&8!=0{cast.push('q')}if cast.is_empty(){cast.push('-')}
 let ep=board.en_passant.map(square).unwrap_or_else(||"-".into());
 format!("{} {} {} {} {} {}",ranks.join("/"),if board.white_to_move{"w"}else{"b"},cast,ep,board.halfmove,board.fullmove)
}

#[derive(Clone,Debug,Serialize,Default)]pub struct EvaluationResult{pub games:u64,pub wins:u64,pub draws:u64,pub losses:u64,pub score:f32,pub generation:u64}

pub fn evaluate_network(root:&Path,network:&Network,generation:u64,games:u64,max_plies:usize,depth:u8,threads:u32)->Result<EvaluationResult,String>{
 let mut engine=EngineSession::new(root,engine::default_engine_id(),threads)?;let mut wins=0;let mut draws=0;let mut losses=0;
 for game in 0..games.max(2){
  let mut board=Board::default();let mut history=HashMap::new();*history.entry(board.position_key()).or_insert(0)+=1;let learner_white=game%2==0;let mut mcts=Mcts::new();
  for _ in 0..max_plies{
   if let Some(_) = adjudicate(&board,&history,true){break}
   let legal=board.legal_moves();if legal.is_empty(){break}
   let mv=if board.white_to_move==learner_white{Some(mcts.search_with_policy(&board,network,32,false).0).flatten()}else{let allowed:Vec<String>=legal.iter().map(|m|move_uci(*m)).collect();let u=engine.best_move(&fen(&board),depth,&allowed)?;legal.iter().find(|m|move_uci(**m)==u).copied().ok_or("Stockfish returned an illegal move")?};
   if board.make(mv).is_err(){return Err("learner produced an illegal move".into())}*history.entry(board.position_key()).or_insert(0)+=1;
  }
  let outcome=if let Some(r)=adjudicate(&board,&history,true){r}else{GameResult::Draw};
  match (learner_white,outcome){(true,GameResult::WhiteWin)|(false,GameResult::BlackWin)=>wins+=1,(true,GameResult::BlackWin)|(false,GameResult::WhiteWin)=>losses+=1,_=>draws+=1}
 }
 let total=wins+draws+losses;Ok(EvaluationResult{games:total,wins,draws,losses,score:if total>0{(wins as f32+0.5*draws as f32)/total as f32}else{0.0},generation})
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn replay_buffer_is_bounded(){let mut r=ReplayBuffer::new(2);let b=Board::default();for _ in 0..3{r.push(PositionSample{board:b,policy:Vec::new(),value:0.0,priority:1.0});}assert_eq!(r.len(),2)}
 #[test]fn mcts_returns_legal_move(){let b=Board::default();let mut m=Mcts::new();let mv=m.search(&b,&Network::new(),8).unwrap();assert!(b.legal_moves().contains(&mv))}
 #[test]fn mcts_policy_is_normalized(){let b=Board::default();let mut m=Mcts::new();let(_,p)=m.search_with_policy(&b,&Network::new(),16,false);let sum:f32=p.iter().map(|x|x.1).sum();assert!((sum-1.0).abs()<1e-4)}
 #[test]fn training_produces_replay(){let mut t=Trainer::new();let n=t.self_play_game(4,4);assert_eq!(n,4);assert_eq!(t.replay.len(),4)}
 #[test]fn checkmate_is_adjudicated(){let b=Board::from_fen("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1").unwrap();let h=HashMap::new();assert_eq!(adjudicate(&b,&h,true),Some(GameResult::WhiteWin))}
}
