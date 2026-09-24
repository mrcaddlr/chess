use crate::neural::Network;

pub struct Optimizer { pub learning_rate:f32, pub step:u64 }
impl Optimizer {
 pub fn new(lr:f32)->Self{Self{learning_rate:lr,step:0}}
 pub fn update(&mut self, network:&mut Network, samples:f32, target:f32){
  let error=(target-samples).clamp(-1.0,1.0);
  for w in &mut network.value { *w += self.learning_rate*error; }
  self.step+=1;
 }
}

#[derive(Default,Clone)]
pub struct LossStats { pub policy:f32,pub value:f32,pub total:f32,pub samples:usize }
