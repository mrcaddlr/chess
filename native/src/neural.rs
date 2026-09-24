use crate::chess::{Board,Move};

pub const INPUTS:usize=832;
pub const HIDDEN:usize=384;
pub const POLICY_BUCKETS:usize=4096;

#[derive(Clone)]
pub struct Network{pub w1:Vec<f32>,pub b1:Vec<f32>,pub policy:Vec<f32>,pub value:Vec<f32>}

#[derive(Clone,Debug,Default)]
pub struct Gradients{
    pub w1:Vec<f32>,pub b1:Vec<f32>,pub policy:Vec<f32>,pub value:Vec<f32>,
    pub policy_loss:f32,pub value_loss:f32,pub samples:usize,
}

impl Gradients{
    pub fn zero()->Self{Self{
        w1:vec![0.0;INPUTS*HIDDEN],b1:vec![0.0;HIDDEN],
        policy:vec![0.0;HIDDEN*POLICY_BUCKETS],value:vec![0.0;HIDDEN],
        ..Self::default()
    }}
    pub fn scale(&mut self,s:f32){
        for v in &mut self.w1{*v*=s;} for v in &mut self.b1{*v*=s;}
        for v in &mut self.policy{*v*=s;} for v in &mut self.value{*v*=s;}
        self.policy_loss*=s;self.value_loss*=s;
    }
    pub fn add(&mut self,other:&Gradients){
        for(i,v)in other.w1.iter().enumerate(){self.w1[i]+=v;}
        for(i,v)in other.b1.iter().enumerate(){self.b1[i]+=v;}
        for(i,v)in other.policy.iter().enumerate(){self.policy[i]+=v;}
        for(i,v)in other.value.iter().enumerate(){self.value[i]+=v;}
        self.policy_loss+=other.policy_loss;self.value_loss+=other.value_loss;self.samples+=other.samples;
    }
}

impl Network{
 pub fn new()->Self{Self{w1:vec![0.0;INPUTS*HIDDEN],b1:vec![0.0;HIDDEN],policy:vec![0.0;HIDDEN*POLICY_BUCKETS],value:vec![0.0;HIDDEN]}}
 pub fn encode(b:&Board)->Vec<f32>{let mut x=vec![0.0;INPUTS];for(i,p)in b.squares.iter().enumerate(){let s=match p{'P'=>0,'N'=>1,'B'=>2,'R'=>3,'Q'=>4,'K'=>5,'p'=>6,'n'=>7,'b'=>8,'r'=>9,'q'=>10,'k'=>11,_=>12};x[s*64+i]=1.0;}x[12*64]=if b.white_to_move{1.0}else{0.0};x}
 fn relu(v:f32)->f32{v.max(0.0)}
 pub fn forward(&self,b:&Board)->(Vec<f32>,f32,Vec<f32>){let x=Self::encode(b);let mut h=vec![0.0;HIDDEN];for j in 0..HIDDEN{let mut s=self.b1[j];for i in 0..INPUTS{s+=x[i]*self.w1[j*INPUTS+i];}h[j]=Self::relu(s);}let mut z=vec![0.0;POLICY_BUCKETS];for k in 0..POLICY_BUCKETS{let mut s=0.0;for j in 0..HIDDEN{s+=h[j]*self.policy[j*POLICY_BUCKETS+k];}z[k]=s;}let mx=z.iter().copied().fold(f32::NEG_INFINITY,f32::max);let mut sum=0.0;for v in &mut z{*v=(*v-mx).exp();sum+=*v;}for v in &mut z{*v/=sum.max(1e-12);}let mut v=0.0;for j in 0..HIDDEN{v+=h[j]*self.value[j];}(z,v.tanh(),h)}
 pub fn infer(&self,b:&Board)->(Vec<f32>,f32){let(p,v,_)=self.forward(b);(p,v)}
 pub fn move_index(m:Move)->usize{((m.from as usize)*64+m.to as usize)%POLICY_BUCKETS}

 pub fn gradients(&self,b:&Board,policy_target:&[(Move,f32)],value_target:f32)->Gradients{
   let x=Self::encode(b);
   let mut h=vec![0.0;HIDDEN];
   for j in 0..HIDDEN{let mut s=self.b1[j];for i in 0..INPUTS{s+=x[i]*self.w1[j*INPUTS+i];}h[j]=Self::relu(s);}
   let mut logits=vec![0.0;POLICY_BUCKETS];
   for k in 0..POLICY_BUCKETS{let mut s=0.0;for j in 0..HIDDEN{s+=h[j]*self.policy[j*POLICY_BUCKETS+k];}logits[k]=s;}
   let mx=logits.iter().copied().fold(f32::NEG_INFINITY,f32::max);let mut sum=0.0;
   for v in &mut logits{*v=(*v-mx).exp();sum+=*v;}for v in &mut logits{*v/=sum.max(1e-12);}
   let mut target=vec![0.0;POLICY_BUCKETS];let mut target_sum=0.0;
   for(m,p)in policy_target{let i=Self::move_index(*m);if i<POLICY_BUCKETS{target[i]+=p.max(0.0);target_sum+=p.max(0.0);}}
   if target_sum>0.0{for v in &mut target{*v/=target_sum;}}
   let mut dlogits=logits.clone();
   for k in 0..POLICY_BUCKETS{dlogits[k]-=target[k];}
   let mut value_raw=0.0;for j in 0..HIDDEN{value_raw+=h[j]*self.value[j];}
   let value=value_raw.tanh();let value_error=value-value_target;let dvalue=value_error*(1.0-value*value);
   let mut g=Gradients::zero();
   g.samples=1;g.value_loss=value_error*value_error;
   for j in 0..HIDDEN{g.value[j]+=dvalue*h[j];}
   for k in 0..POLICY_BUCKETS{for j in 0..HIDDEN{g.policy[j*POLICY_BUCKETS+k]+=dlogits[k]*h[j];}}
   let mut dh=vec![0.0;HIDDEN];
   for j in 0..HIDDEN{let mut s=dvalue*self.value[j];for k in 0..POLICY_BUCKETS{s+=dlogits[k]*self.policy[j*POLICY_BUCKETS+k];}dh[j]=if h[j]>0.0{s}else{0.0};}
   for j in 0..HIDDEN{g.b1[j]+=dh[j];for i in 0..INPUTS{g.w1[j*INPUTS+i]+=dh[j]*x[i];}}
   let mut pl=0.0;for k in 0..POLICY_BUCKETS{if target[k]>0.0{pl-=target[k]*logits[k].max(1e-12).ln();}}g.policy_loss=pl;
   g
 }

 pub fn apply_gradients(&mut self,g:&Gradients,lr:f32){for(i,w)in self.w1.iter_mut().enumerate(){*w-=lr*g.w1[i];}for(i,w)in self.b1.iter_mut().enumerate(){*w-=lr*g.b1[i];}for(i,w)in self.policy.iter_mut().enumerate(){*w-=lr*g.policy[i];}for(i,w)in self.value.iter_mut().enumerate(){*w-=lr*g.value[i];}}
 pub fn train_value(&mut self,b:&Board,target:f32,lr:f32)->f32{let g=self.gradients(b,&[],target);let loss=g.value_loss;self.apply_gradients(&g,lr);loss}
}

#[cfg(test)]
mod tests{use super::*;#[test]fn encoding_size(){assert_eq!(Network::encode(&Board::default()).len(),INPUTS)}#[test]fn inference_finite(){let(p,v,_)=Network::new().forward(&Board::default());assert_eq!(p.len(),POLICY_BUCKETS);assert!(v.is_finite())}#[test]fn gradients_have_expected_shapes(){let g=Network::new().gradients(&Board::default(),&[],0.0);assert_eq!(g.w1.len(),INPUTS*HIDDEN);assert_eq!(g.policy.len(),HIDDEN*POLICY_BUCKETS);assert_eq!(g.value.len(),HIDDEN);}}
