use crate::neural::{Gradients,Network};

pub struct Optimizer { pub learning_rate:f32,pub step:u64, pub weight_decay:f32 }

impl Optimizer {
 pub fn new(lr:f32)->Self{Self{learning_rate:lr,step:0,weight_decay:1e-5}}
 pub fn update_gradients(&mut self,network:&mut Network,gradients:&Gradients){
   if gradients.samples==0{return;}
   let scale=1.0/gradients.samples as f32;
   let mut g=gradients.clone();g.scale(scale);
   network.apply_gradients(&g,self.learning_rate);
   if self.weight_decay>0.0{let d=1.0-self.learning_rate*self.weight_decay;for w in network.w1.iter_mut().chain(network.policy.iter_mut()).chain(network.value.iter_mut()){*w*=d;}}
   self.step+=1;
 }
 pub fn update(&mut self,network:&mut Network,samples:f32,target:f32){
   let error=(target-samples).clamp(-1.0,1.0);
   let mut g=Gradients::zero();
   for w in &mut g.value{*w=-error;}
   g.samples=1;self.update_gradients(network,&g);
 }
}

#[derive(Default,Clone)]
pub struct LossStats {pub policy:f32,pub value:f32,pub total:f32,pub samples:usize}

impl LossStats{
 pub fn from_gradients(g:&Gradients)->Self{
   let n=g.samples.max(1) as f32;
   let policy=g.policy_loss/n;let value=g.value_loss/n;
   Self{policy,value,total:policy+value,samples:g.samples}
 }
}
