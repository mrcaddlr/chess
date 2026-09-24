use crate::{chess::{Board,Move},neural::{Network,Gradients},optimizer::{Optimizer,LossStats}};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone,Debug)]pub struct PositionSample{pub board:Board,pub policy:Vec<(Move,f32)>,pub value:f32}

#[derive(Default)]pub struct ReplayBuffer{capacity:usize,samples:Vec<PositionSample>}
impl ReplayBuffer{
 pub fn new(capacity:usize)->Self{Self{capacity:capacity.max(1),samples:Vec::new()}}
 pub fn push(&mut self,sample:PositionSample){if self.samples.len()>=self.capacity{self.samples.remove(0);}self.samples.push(sample);}
 pub fn len(&self)->usize{self.samples.len()}
 pub fn recent(&self,count:usize)->&[PositionSample]{let start=self.samples.len().saturating_sub(count);&self.samples[start..]}
 pub fn all(&self)->&[PositionSample]{&self.samples}
}

#[derive(Clone,Debug)]pub struct SearchNode{pub visits:u32,pub value_sum:f32,pub prior:f32,pub children:HashMap<u8,usize>,pub mv:Option<Move>}

pub struct Mcts{pub nodes:Vec<SearchNode>,pub exploration:f32}
impl Mcts{
 pub fn new()->Self{Self{nodes:Vec::new(),exploration:1.4}}
 pub fn search_with_policy(&mut self,board:&Board,network:&Network,simulations:usize)->(Option<Move>,Vec<(Move,f32)>){
   let legal=board.legal_moves();if legal.is_empty(){return(None,Vec::new());}
   self.nodes.clear();self.nodes.push(SearchNode{visits:0,value_sum:0.0,prior:1.0,children:HashMap::new(),mv:None});
   let (priors,root_value)=network.infer(board);
   for mv in &legal{let p=priors[Network::move_index(*mv)];let idx=self.nodes.len();self.nodes.push(SearchNode{visits:0,value_sum:0.0,prior:p.max(1e-6),children:HashMap::new(),mv:Some(*mv)});self.nodes[0].children.insert(mv.to,idx);}
   self.nodes[0].value_sum=root_value;
   for _ in 0..simulations.max(1){
     let parent_visits=self.nodes[0].visits.max(1) as f32;
     let mut best=None;let mut best_score=f32::NEG_INFINITY;
     for mv in &legal{let idx=self.nodes[0].children[mv.to];let n=&self.nodes[idx];let q=if n.visits==0{0.0}else{n.value_sum/n.visits as f32};let u=self.exploration*n.prior*parent_visits.sqrt()/(1.0+n.visits as f32);let score=q+u;if score>best_score{best_score=score;best=Some(idx);}}
     let idx=best.unwrap();let mv=self.nodes[idx].mv.unwrap();let mut child=*board;let _=child.make(mv);
     let (_,value)=network.infer(&child);self.nodes[idx].visits+=1;self.nodes[idx].value_sum+=-value;self.nodes[0].visits+=1;self.nodes[0].value_sum+=-value;
   }
   let policy=legal.iter().map(|mv|{let idx=self.nodes[0].children[mv.to];(*mv,self.nodes[idx].visits as f32)}).collect::<Vec<_>>();
   let best=policy.iter().max_by(|a,b|a.1.partial_cmp(&b.1).unwrap()).map(|x|x.0);
   (best,policy)
 }
 pub fn search(&mut self,board:&Board,simulations:usize)->Option<Move>{let n=Network::new();self.search_with_policy(board,&n,simulations).0}
}

#[derive(Clone,Serialize,Default)]pub struct TrainingStatus{pub running:bool,pub paused:bool,pub generation:u64,pub games:u64,pub positions:u64,pub loss:f32,pub replay_size:usize}

pub struct Trainer{pub replay:ReplayBuffer,pub mcts:Mcts,pub network:Network,pub optimizer:Optimizer}

impl Trainer{
 pub fn new()->Self{Self{replay:ReplayBuffer::new(100_000),mcts:Mcts::new(),network:Network::new(),optimizer:Optimizer::new(0.001)}}
 pub fn self_play_game(&mut self,max_plies:usize)->usize{
   let mut board=Board::default();let mut positions=Vec::new();
   for _ in 0..max_plies{
     let legal=board.legal_moves();if legal.is_empty(){break;}
     let(mv,policy)=self.mcts.search_with_policy(&board,&self.network,32);let mv=mv.unwrap_or(legal[0]);
     positions.push((board,policy));let _=board.make(mv);
   }
   let value=0.0;
   for(board,policy)in positions{self.replay.push(PositionSample{board,policy,value});}
   self.replay.recent(max_plies).len()
 }
 pub fn train_steps(&mut self,steps:usize,batch_size:usize)->LossStats{
   let mut total=Gradients::zero();let take=batch_size.max(1).min(self.replay.len());
   if take==0{return LossStats::default();}
   let start=self.replay.len().saturating_sub(take);
   for s in &self.replay.all()[start..]{let g=self.network.gradients(&s.board,&s.policy,s.value);total.add(&g);}
   self.optimizer.update_gradients(&mut self.network,&total);LossStats::from_gradients(&total)
 }
 pub fn run_self_play(&mut self,games:u64)->TrainingStatus{
   let mut positions=0;for _ in 0..games{positions+=self.self_play_game(200);}let loss=self.train_steps(games.max(1) as usize,32).total;
   TrainingStatus{running:false,paused:false,generation:1,games,positions:positions as u64,loss,replay_size:self.replay.len()}
 }
 pub fn run(&mut self,games:u64)->TrainingStatus{self.run_self_play(games)}
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn replay_buffer_is_bounded(){let mut r=ReplayBuffer::new(2);let b=Board::default();for _ in 0..3{r.push(PositionSample{board:b,policy:Vec::new(),value:0.0});}assert_eq!(r.len(),2);}
 #[test]fn mcts_returns_a_legal_move(){let b=Board::default();let mut m=Mcts::new();let mv=m.search(&b,8).unwrap();assert!(b.legal_moves().contains(&mv));}
 #[test]fn training_produces_replay(){let mut t=Trainer::new();let n=t.self_play_game(4);assert_eq!(n,4);assert_eq!(t.replay.len(),4);}
}
