use crate::{chess::{Board,Move},neural::{Network,Gradients},optimizer::{Optimizer,LossStats}};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone,Debug)]pub struct PositionSample{pub board:Board,pub policy:Vec<(Move,f32)>,pub value:f32,pub priority:f32}

#[derive(Default)]pub struct ReplayBuffer{capacity:usize,samples:Vec<PositionSample>,seed:u64}
impl ReplayBuffer{
 pub fn new(capacity:usize)->Self{Self{capacity:capacity.max(1),samples:Vec::new(),seed:0x517cc1b727220a95}}
 pub fn push(&mut self,mut sample:PositionSample){sample.priority=sample.priority.max(1e-3);if self.samples.len()>=self.capacity{self.samples.remove(0);}self.samples.push(sample);}
 pub fn len(&self)->usize{self.samples.len()}
 pub fn recent(&self,count:usize)->&[PositionSample]{let start=self.samples.len().saturating_sub(count);&self.samples[start..]}
 pub fn all(&self)->&[PositionSample]{&self.samples}
 fn random_unit(&mut self)->f32{self.seed^=self.seed<<13;self.seed^=self.seed>>7;self.seed^=self.seed<<17;(self.seed as f64/u64::MAX as f64)as f32}
 pub fn sample_indices(&mut self,count:usize)->Vec<usize>{
  let n=self.samples.len();if n==0{return Vec::new();}let take=count.min(n);
  let mut out=Vec::with_capacity(take);let recent_count=(take/4).max(1).min(n);
  let recent_start=n-recent_count;for i in recent_start..n{out.push(i);}
  while out.len()<take{
   let total:f32=self.samples.iter().map(|s|s.priority.max(1e-3)).sum();let mut r=self.random_unit()*total;let mut chosen=0;
   for(i,s)in self.samples.iter().enumerate(){r-=s.priority.max(1e-3);if r<=0.0{chosen=i;break;}}
   if !out.contains(&chosen){out.push(chosen);}
   else if out.len()<take{let fallback=(self.random_unit()*(n as f32))as usize; if !out.contains(&fallback){out.push(fallback);}}
  }
  out
 }
 pub fn update_priorities(&mut self,indices:&[usize],losses:&[f32]){for(&i,&loss)in indices.iter().zip(losses.iter()){if let Some(s)=self.samples.get_mut(i){s.priority=(loss.abs()+0.05).min(10.0);}}}
}

#[derive(Clone,Debug)]pub struct SearchNode{pub visits:u32,pub value_sum:f32,pub prior:f32,pub children:HashMap<Move,usize>,pub mv:Option<Move>,pub expanded:bool}

pub struct Mcts{pub nodes:Vec<SearchNode>,pub exploration:f32,seed:u64}
impl Mcts{
 pub fn new()->Self{Self{nodes:Vec::new(),exploration:1.4,seed:0x9e3779b97f4a7c15}}
 fn random_unit(&mut self)->f32{self.seed^=self.seed<<13;self.seed^=self.seed>>7;self.seed^=self.seed<<17;(self.seed as f64/u64::MAX as f64)as f32}
 fn expand(&mut self,idx:usize,board:&Board,network:&Network)->f32{
   let legal=board.legal_moves();
   if legal.is_empty(){return if board.in_check(board.white_to_move){-1.0}else{0.0};}
   let(priors,value)=network.infer(board);
   let mut weights=Vec::with_capacity(legal.len());let mut sum=0.0;
   for mv in &legal{let p=priors[Network::move_index(*mv)].max(1e-6);weights.push((*mv,p));sum+=p;}
   for(mv,p)in weights{let child=self.nodes.len();self.nodes.push(SearchNode{visits:0,value_sum:0.0,prior:p/sum,children:HashMap::new(),mv:Some(mv),expanded:false});self.nodes[idx].children.insert(mv,child);}
   self.nodes[idx].expanded=true;
   value
 }
 fn simulate(&mut self,idx:usize,board:Board,network:&Network,depth:usize)->f32{
   if depth>=256{return 0.0;}
   if board.legal_moves().is_empty(){return if board.in_check(board.white_to_move){-1.0}else{0.0};}
   if !self.nodes[idx].expanded{let value=self.expand(idx,&board,network);self.nodes[idx].visits+=1;self.nodes[idx].value_sum+=value;return value;}
   let parent_visits=self.nodes[idx].visits.max(1)as f32;
   let mut best=None;let mut best_score=f32::NEG_INFINITY;
   for(mv,&child_idx)in &self.nodes[idx].children{
     let n=&self.nodes[child_idx];let q=if n.visits==0{0.0}else{n.value_sum/n.visits as f32};
     let u=self.exploration*n.prior*parent_visits.sqrt()/(1.0+n.visits as f32);
     let score=q+u;if score>best_score{best_score=score;best=Some((*mv,child_idx));}
   }
   let(mv,child_idx)=best.unwrap();let mut child_board=board;let _=child_board.make(mv);
   let value=-self.simulate(child_idx,child_board,network,depth+1);
   self.nodes[idx].visits+=1;self.nodes[idx].value_sum+=value;value
 }
 pub fn search_with_policy(&mut self,board:&Board,network:&Network,simulations:usize,add_noise:bool)->(Option<Move>,Vec<(Move,f32)>){
   let legal=board.legal_moves();if legal.is_empty(){return(None,Vec::new());}
   self.nodes.clear();self.nodes.push(SearchNode{visits:0,value_sum:0.0,prior:1.0,children:HashMap::new(),mv:None,expanded:false});
   let _=self.expand(0,board,network);

   if add_noise{
    let alpha=0.30;let epsilon=0.25;let mut noise_sum=0.0;let mut noises=Vec::with_capacity(legal.len());
    for _ in &legal{let n=self.random_unit().max(1e-6).powf(1.0/alpha);noises.push(n);noise_sum+=n;}
    for(mv,n)in legal.iter().zip(noises.iter()){if let Some(&idx)=self.nodes[0].children.get(mv){let old=self.nodes[idx].prior;self.nodes[idx].prior=(1.0-epsilon)*old+epsilon*(n/noise_sum.max(1e-9));}}
   }

   for _ in 0..simulations.max(1){let _=self.simulate(0,*board,network,0);}
   let total=self.nodes[0].children.values().map(|&i|self.nodes[i].visits as f32).sum::<f32>().max(1.0);
   let mut policy=legal.iter().map(|mv|{let idx=self.nodes[0].children[mv];(*mv,self.nodes[idx].visits as f32/total)}).collect::<Vec<_>>();
   policy.sort_by(|a,b|b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
   let best=policy.first().map(|x|x.0);
   (best,policy)
 }
 pub fn search(&mut self,board:&Board,simulations:usize)->Option<Move>{let n=Network::new();self.search_with_policy(board,&n,simulations,false).0}
}

#[derive(Clone,Copy,Debug,PartialEq,Eq)]pub enum GameResult{WhiteWin,BlackWin,Draw}
impl GameResult{pub fn value_for(&self,white_to_move:bool)->f32{match self{Self::WhiteWin=>if white_to_move{1.0}else{-1.0},Self::BlackWin=>if white_to_move{-1.0}else{1.0},Self::Draw=>0.0}}}

#[derive(Clone,Debug,PartialEq,Eq)]pub enum GameTermination{Checkmate{winner_white:bool},Stalemate,InsufficientMaterial,Repetition,SeventyFiveMove,MaxPlies}

pub fn adjudicate(board:&Board,history:&HashMap<String,u32>,automatic_repetition:bool)->Option<GameResult>{
 let legal=board.legal_moves();
 if legal.is_empty(){return if board.in_check(board.white_to_move){Some(if board.white_to_move{GameResult::BlackWin}else{GameResult::WhiteWin})}else{Some(GameResult::Draw)}}
 if board.insufficient_material(){return Some(GameResult::Draw)}
 if board.halfmove>=150{return Some(GameResult::Draw)}
 if automatic_repetition&&history.get(&board.position_key()).copied().unwrap_or(0)>=5{return Some(GameResult::Draw)}
 None
}

#[derive(Clone,Serialize,Default)]pub struct TrainingStatus{pub running:bool,pub paused:bool,pub generation:u64,pub games:u64,pub positions:u64,pub loss:f32,pub replay_size:usize}
pub struct Trainer{pub replay:ReplayBuffer,pub mcts:Mcts,pub network:Network,pub optimizer:Optimizer}

impl Trainer{
 pub fn new()->Self{Self{replay:ReplayBuffer::new(100_000),mcts:Mcts::new(),network:Network::new(),optimizer:Optimizer::new(0.001)}}
 pub fn self_play_game(&mut self,max_plies:usize)->usize{
   let mut board=Board::default();let mut positions=Vec::new();let mut history=HashMap::<String,u32>::new();*history.entry(board.position_key()).or_insert(0)+=1;let mut result=None;
   for _ in 0..max_plies{
     if let Some(r)=adjudicate(&board,&history,true){result=Some(r);break;}
     let legal=board.legal_moves();if legal.is_empty(){result=Some(if board.in_check(board.white_to_move){if board.white_to_move{GameResult::BlackWin}else{GameResult::WhiteWin}}else{GameResult::Draw});break;}
     let(_,policy)=self.mcts.search_with_policy(&board,&self.network,64,true);
     let temperature=if positions.len()<12{1.0}else if positions.len()<32{0.5}else{0.15};
     let mv=if temperature<=0.15{policy.first().map(|x|x.0)}else{
       let weights:Vec<(Move,f32)>=policy.iter().map(|(m,p)|(*m,p.max(1e-6).powf(1.0/temperature))).collect();
       let sum:f32=weights.iter().map(|x|x.1).sum();let mut r=self.mcts.random_unit()*sum;let mut chosen=None;
       for(m,w)in weights{r-=w;if r<=0.0{chosen=Some(m);break;}}chosen.or_else(||policy.first().map(|x|x.0))
     };
     let mv=mv.filter(|m|legal.contains(m)).unwrap_or(legal[0]);
     positions.push((board,policy));if board.make(mv).is_err(){result=Some(GameResult::Draw);break;}*history.entry(board.position_key()).or_insert(0)+=1;
   }
   let result=result.unwrap_or(GameResult::Draw);for(board,policy)in positions{let entropy=policy.iter().map(|(_,p)|{let q=p.max(1e-9);-q*q.ln()}).sum::<f32>();let priority=0.25+entropy+(1.0-result.value_for(board.white_to_move).abs());self.replay.push(PositionSample{board,policy,value:result.value_for(board.white_to_move),priority});}self.replay.recent(max_plies).len()
 }
 pub fn train_steps(&mut self,steps:usize,batch_size:usize)->LossStats{
   let mut last=LossStats::default();if self.replay.len()==0{return last;}
   for _ in 0..steps.max(1){let indices=self.replay.sample_indices(batch_size.max(1));let mut total=Gradients::zero();let mut losses=Vec::with_capacity(indices.len());
     for &i in &indices{let s=&self.replay.all()[i];let g=self.network.gradients(&s.board,&s.policy,s.value);losses.push(g.policy_loss+g.value_loss);total.add(&g);}
     self.optimizer.update_gradients(&mut self.network,&total);last=LossStats::from_gradients(&total);self.replay.update_priorities(&indices,&losses);
   }last
 }
 pub fn run_self_play(&mut self,games:u64)->TrainingStatus{let mut positions=0;for _ in 0..games{positions+=self.self_play_game(200);}let loss=self.train_steps(games.max(1)as usize,32).total;TrainingStatus{running:false,paused:false,generation:1,games,positions:positions as u64,loss,replay_size:self.replay.len()}}
 pub fn run(&mut self,games:u64)->TrainingStatus{self.run_self_play(games)}
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn replay_buffer_is_bounded(){let mut r=ReplayBuffer::new(2);let b=Board::default();for _ in 0..3{r.push(PositionSample{board:b,policy:Vec::new(),value:0.0,priority:1.0});}assert_eq!(r.len(),2);}
 #[test]fn mcts_returns_a_legal_move(){let b=Board::default();let mut m=Mcts::new();let mv=m.search(&b,8).unwrap();assert!(b.legal_moves().contains(&mv));}
 #[test]fn mcts_policy_is_normalized(){let b=Board::default();let mut m=Mcts::new();let(_,p)=m.search_with_policy(&b,&Network::new(),16);let sum:f32=p.iter().map(|x|x.1).sum();assert!((sum-1.0).abs()<1e-4);}
 #[test]fn training_produces_replay(){let mut t=Trainer::new();let n=t.self_play_game(4);assert_eq!(n,4);assert_eq!(t.replay.len(),4);assert!(!t.replay.sample_indices(2).is_empty());}
 #[test]fn checkmate_is_adjudicated(){let b=Board::from_fen("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1").unwrap();let h=HashMap::new();assert_eq!(adjudicate(&b,&h,true),Some(GameResult::WhiteWin));}
 #[test]fn stalemate_is_adjudicated(){let b=Board::from_fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").unwrap();let h=HashMap::new();assert_eq!(adjudicate(&b,&h,true),Some(GameResult::Draw));}
 #[test]fn fivefold_repetition_is_adjudicated(){let b=Board::default();let mut h=HashMap::new();h.insert(b.position_key(),5);assert_eq!(adjudicate(&b,&h,true),Some(GameResult::Draw));}
 #[test]fn side_relative_result_is_correct(){assert_eq!(GameResult::WhiteWin.value_for(true),1.0);assert_eq!(GameResult::WhiteWin.value_for(false),-1.0);assert_eq!(GameResult::BlackWin.value_for(true),-1.0);}
}
