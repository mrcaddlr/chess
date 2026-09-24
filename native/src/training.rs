use crate::chess::Board;
use serde::Serialize;
use std::sync::{Arc,atomic::{AtomicBool,Ordering}};
use std::{thread,time::Duration};

#[derive(Clone,Serialize,Default)]
pub struct TrainingStatus { pub running:bool,pub paused:bool,pub generation:u64,pub games:u64,pub positions:u64,pub loss:f32 }

pub struct Trainer { stop:Arc<AtomicBool>, pause:Arc<AtomicBool> }
impl Trainer {
    pub fn new()->Self{Self{stop:Arc::new(AtomicBool::new(false)),pause:Arc::new(AtomicBool::new(false))}}
    pub fn run(&self,games:u64)->TrainingStatus{
        let mut positions=0;
        let mut completed=0;
        for _ in 0..games {
            if self.stop.load(Ordering::Relaxed){break}
            while self.pause.load(Ordering::Relaxed){thread::sleep(Duration::from_millis(10));}
            let mut b=Board::default();
            for _ in 0..200 {
                let moves=b.pseudo_legal_moves(); if moves.is_empty(){break}
                let _=b.make(moves[0]); positions+=1;
                if self.stop.load(Ordering::Relaxed){break}
            }
            completed+=1;
        }
        TrainingStatus{running:false,paused:false,generation:1,games:completed,positions,loss:0.0}
    }
    pub fn stop(&self){self.stop.store(true,Ordering::Relaxed)}
    pub fn pause(&self,v:bool){self.pause.store(v,Ordering::Relaxed)}
}
