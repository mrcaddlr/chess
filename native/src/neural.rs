use crate::chess::{Board,Move};
pub const INPUTS:usize=832;pub const HIDDEN:usize=384;pub const POLICY_BUCKETS:usize=4096;
#[derive(Clone)]pub struct Network{pub w1:Vec<f32>,pub b1:Vec<f32>,pub policy:Vec<f32>,pub value:Vec<f32>}
impl Network{
 pub fn new()->Self{Self{w1:vec![0.0;INPUTS*HIDDEN],b1:vec![0.0;HIDDEN],policy:vec![0.0;HIDDEN*POLICY_BUCKETS],value:vec![0.0;HIDDEN]}}
 pub fn encode(b:&Board)->Vec<f32>{let mut x=vec![0.0;INPUTS];for(i,p)in b.squares.iter().enumerate(){let s=match p{'P'=>0,'N'=>1,'B'=>2,'R'=>3,'Q'=>4,'K'=>5,'p'=>6,'n'=>7,'b'=>8,'r'=>9,'q'=>10,'k'=>11,_=>12};x[s*64+i]=1.0;}x[12*64]=if b.white_to_move{1.0}else{0.0};x}
 fn relu(v:f32)->f32{v.max(0.0)}
 pub fn forward(&self,b:&Board)->(Vec<f32>,f32,Vec<f32>){let x=Self::encode(b);let mut h=vec![0.0;HIDDEN];for j in 0..HIDDEN{let mut s=self.b1[j];for i in 0..INPUTS{s+=x[i]*self.w1[j*INPUTS+i];}h[j]=Self::relu(s);}let mut z=vec![0.0;POLICY_BUCKETS];for k in 0..POLICY_BUCKETS{let mut s=0.0;for j in 0..HIDDEN{s+=h[j]*self.policy[j*POLICY_BUCKETS+k];}z[k]=s;}let mx=z.iter().copied().fold(f32::NEG_INFINITY,f32::max);let mut sum=0.0;for v in &mut z{*v=(*v-mx).exp();sum+=*v;}for v in &mut z{*v/=sum.max(1e-12);}let mut v=0.0;for j in 0..HIDDEN{v+=h[j]*self.value[j];}(z,v.tanh(),h)}
 pub fn infer(&self,b:&Board)->(Vec<f32>,f32){let(p,v,_)=self.forward(b);(p,v)}
 pub fn move_index(m:Move)->usize{((m.from as usize)*64+m.to as usize)%POLICY_BUCKETS}
 pub fn train_value(&mut self,b:&Board,target:f32,lr:f32)->f32{let(_,v,h)=self.forward(b);let err=target-v;let grad=(1.0-v*v)*err;for j in 0..HIDDEN{self.value[j]+=lr*grad*h[j];}err*err}
}
#[cfg(test)]mod tests{use super::*;#[test]fn encoding_size(){assert_eq!(Network::encode(&Board::default()).len(),INPUTS)}#[test]fn inference_finite(){let(p,v,_)=Network::new().forward(&Board::default());assert_eq!(p.len(),POLICY_BUCKETS);assert!(v.is_finite())}}
