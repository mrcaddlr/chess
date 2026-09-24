use crate::chess::{Board, Move};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Serialize, Default)]
pub struct PolicyValue { pub value: f32 }

#[derive(Clone, Debug)]
pub struct PositionSample {
    pub board: Board,
    pub policy: Vec<(Move, f32)>,
    pub value: f32,
}

#[derive(Default)]
pub struct ReplayBuffer {
    capacity: usize,
    samples: Vec<PositionSample>,
}

impl ReplayBuffer {
    pub fn new(capacity: usize) -> Self { Self { capacity: capacity.max(1), samples: Vec::new() } }
    pub fn push(&mut self, sample: PositionSample) {
        if self.samples.len() >= self.capacity { self.samples.remove(0); }
        self.samples.push(sample);
    }
    pub fn len(&self) -> usize { self.samples.len() }
    pub fn recent(&self, count: usize) -> &[PositionSample] {
        let start = self.samples.len().saturating_sub(count);
        &self.samples[start..]
    }
}

#[derive(Clone, Debug)]
pub struct SearchNode {
    pub visits: u32,
    pub value_sum: f32,
    pub prior: f32,
    pub children: HashMap<u8, usize>,
}

pub struct Mcts {
    pub nodes: Vec<SearchNode>,
    pub exploration: f32,
}

impl Mcts {
    pub fn new() -> Self { Self { nodes: Vec::new(), exploration: 1.25 } }

    pub fn search(&mut self, board: &Board, simulations: usize) -> Option<Move> {
        let legal = board.pseudo_legal_moves();
        if legal.is_empty() { return None; }
        self.nodes.clear();
        self.nodes.push(SearchNode { visits: 0, value_sum: 0.0, prior: 1.0, children: HashMap::new() });

        for _ in 0..simulations.max(1) {
            let mut child = 0usize;
            let mut state = *board;
            let moves = state.pseudo_legal_moves();
            if moves.is_empty() { continue; }
            let mv = moves[(self.nodes[child].visits as usize) % moves.len()];
            let entry = self.nodes[child].children.entry(mv.to).or_insert_with(|| {
                self.nodes.push(SearchNode { visits: 0, value_sum: 0.0, prior: 1.0 / moves.len() as f32, children: HashMap::new() });
                self.nodes.len() - 1
            });
            child = *entry;
            let _ = state.make(mv);
            self.nodes[child].visits += 1;
            self.nodes[child].value_sum += 0.0;
            self.nodes[0].visits += 1;
        }

        legal.into_iter().max_by_key(|mv| self.nodes[0].children.get(&mv.to).map(|i| self.nodes[*i].visits).unwrap_or(0))
    }
}

#[derive(Clone, Serialize, Default)]
pub struct TrainingStatus {
    pub running: bool,
    pub paused: bool,
    pub generation: u64,
    pub games: u64,
    pub positions: u64,
    pub loss: f32,
    pub replay_size: usize,
}

pub struct Trainer {
    pub replay: ReplayBuffer,
    pub mcts: Mcts,
}

impl Trainer {
    pub fn new() -> Self { Self { replay: ReplayBuffer::new(100_000), mcts: Mcts::new() } }

    pub fn self_play_game(&mut self, max_plies: usize) -> usize {
        let mut board = Board::default();
        let mut positions = 0;
        for _ in 0..max_plies {
            let legal = board.pseudo_legal_moves();
            if legal.is_empty() { break; }
            let mv = self.mcts.search(&board, 32).unwrap_or(legal[0]);
            let policy = legal.iter().map(|m| (*m, if *m == mv { 1.0 } else { 0.0 })).collect();
            self.replay.push(PositionSample { board, policy, value: 0.0 });
            let _ = board.make(mv);
            positions += 1;
        }
        positions
    }

    pub fn run_self_play(&mut self, games: u64) -> TrainingStatus {
        let mut positions = 0;
        let mut completed = 0;
        for _ in 0..games {
            positions += self.self_play_game(200);
            completed += 1;
        }
        TrainingStatus { running: false, paused: false, generation: 1, games: completed, positions, loss: 0.0, replay_size: self.replay.len() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replay_buffer_is_bounded() {
        let mut r = ReplayBuffer::new(2);
        let b = Board::default();
        for _ in 0..3 { r.push(PositionSample { board:b, policy:Vec::new(), value:0.0 }); }
        assert_eq!(r.len(),2);
    }
    #[test]
    fn mcts_returns_a_legal_move() {
        let b=Board::default();
        let mut m=Mcts::new();
        let mv=m.search(&b,8).unwrap();
        assert!(b.pseudo_legal_moves().contains(&mv));
    }
}
