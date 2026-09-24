use crate::chess::{Board, Move};

pub const INPUTS: usize = 832;
pub const HIDDEN: usize = 384;
pub const POLICY_BUCKETS: usize = 4096;

#[derive(Clone)]
pub struct Network {
    pub w1: Vec<f32>,
    pub b1: Vec<f32>,
    pub policy: Vec<f32>,
    pub value: Vec<f32>,
}
impl Network {
    pub fn new() -> Self {
        Self { w1: vec![0.0; INPUTS*HIDDEN], b1: vec![0.0;HIDDEN], policy: vec![0.0;HIDDEN*POLICY_BUCKETS], value: vec![0.0;HIDDEN] }
    }
    pub fn encode(board:&Board)->Vec<f32>{
        let mut x=vec![0.0;INPUTS];
        for (i,p) in board.squares.iter().enumerate(){
            let slot=match p{'P'=>0,'N'=>1,'B'=>2,'R'=>3,'Q'=>4,'K'=>5,'p'=>6,'n'=>7,'b'=>8,'r'=>9,'q'=>10,'k'=>11,_=>12};
            x[slot*64+i]=1.0;
        }
        x[12*64]=if board.white_to_move{1.0}else{0.0}; x
    }
    fn relu(v:f32)->f32{v.max(0.0)}
    pub fn infer(&self,board:&Board)->(Vec<f32>,f32){
        let x=Self::encode(board); let mut h=vec![0.0;HIDDEN];
        for j in 0..HIDDEN { let mut s=self.b1[j]; for i in 0..INPUTS{s+=x[i]*self.w1[j*INPUTS+i];} h[j]=Self::relu(s); }
        let mut logits=vec![0.0;POLICY_BUCKETS];
        for k in 0..POLICY_BUCKETS { let mut s=0.0; for j in 0..HIDDEN{s+=h[j]*self.policy[j*POLICY_BUCKETS+k];} logits[k]=s; }
        let max=logits.iter().copied().fold(f32::NEG_INFINITY,f32::max); let mut total=0.0;
        for v in &mut logits{*v=(*v-max).exp();total+=*v;} if total>0.0{for v in &mut logits{*v/=total;}}
        let mut value=0.0; for j in 0..HIDDEN{value+=h[j]*self.value[j];}
        (logits,value.tanh())
    }
    pub fn move_index(m:Move)->usize{((m.from as usize)*64+m.to as usize)%POLICY_BUCKETS}
}
#[cfg(test)]
mod tests{use super::*;#[test]fn encoding_size(){assert_eq!(Network::encode(&Board::default()).len(),INPUTS)}#[test]fn inference_finite(){let(p,v)=Network::new().infer(&Board::default());assert_eq!(p.len(),POLICY_BUCKETS);assert!(v.is_finite());}}
