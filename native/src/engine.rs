use serde::Serialize;
use std::{path::{Path, PathBuf}, process::{Command, Stdio}, io::{BufRead, BufReader, Write}, time::{Duration, Instant}};

#[derive(Clone, Debug, Serialize)]
pub struct EngineInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub path: Option<String>,
    pub installed: bool,
    pub healthy: bool,
    pub supports_threads: bool,
    pub supports_hash: bool,
    pub notes: String,
}

#[derive(Clone, Debug)]
struct EngineDef {
    id: &'static str,
    name: &'static str,
    kind: &'static str,
    relative_path: &'static str,
    supports_threads: bool,
    supports_hash: bool,
}

const ENGINES: &[EngineDef] = &[
    EngineDef { id: "sf19-full-single", name: "Stockfish 19 · Full · Single", kind: "stockfish", relative_path: ".chess-lab/stockfish-19", supports_threads: false, supports_hash: true },
    EngineDef { id: "sf19-full-multi", name: "Stockfish 19 · Full · Multi", kind: "stockfish", relative_path: ".chess-lab/stockfish-19", supports_threads: true, supports_hash: true },
    EngineDef { id: "sf19-lite-single", name: "Stockfish 19 · Lite · Single", kind: "stockfish", relative_path: ".chess-lab/stockfish-19", supports_threads: false, supports_hash: true },
    EngineDef { id: "sf19-lite-multi", name: "Stockfish 19 · Lite · Multi", kind: "stockfish", relative_path: ".chess-lab/stockfish-19", supports_threads: true, supports_hash: true },
    EngineDef { id: "lc0", name: "Leela Chess Zero", kind: "lc0", relative_path: ".chess-lab/lc0", supports_threads: true, supports_hash: true },
    EngineDef { id: "berserk", name: "Berserk", kind: "berserk", relative_path: ".chess-lab/berserk", supports_threads: true, supports_hash: true },
    EngineDef { id: "ethereal", name: "Ethereal", kind: "ethereal", relative_path: ".chess-lab/ethereal", supports_threads: true, supports_hash: true },
    EngineDef { id: "fairy-stockfish", name: "Fairy-Stockfish", kind: "fairy-stockfish", relative_path: ".chess-lab/fairy-stockfish", supports_threads: true, supports_hash: true },
];

fn executable(root: &Path, def: &EngineDef) -> PathBuf {
    root.join(def.relative_path)
}

fn probe(path: &Path) -> bool {
    let mut child = match Command::new(path).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let Some(mut stdin) = child.stdin.take() else { let _ = child.kill(); return false; };
    let Some(stdout) = child.stdout.take() else { let _ = child.kill(); return false; };
    let mut reader = BufReader::new(stdout);
    let _ = stdin.write_all(b"uci\n");
    let _ = stdin.flush();
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut line = String::new();
    let mut ok = false;
    while Instant::now() < deadline {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) if line.trim() == "uciok" => { ok = true; break; }
            Ok(_) => {}
        }
    }
    let _ = child.kill();
    ok
}

pub fn list(root: &Path) -> Vec<EngineInfo> {
    ENGINES.iter().map(|def| {
        let path = executable(root, def);
        let installed = path.is_file();
        EngineInfo {
            id: def.id.into(),
            name: def.name.into(),
            kind: def.kind.into(),
            path: installed.then(|| path.display().to_string()),
            installed,
            healthy: installed && probe(&path),
            supports_threads: def.supports_threads,
            supports_hash: def.supports_hash,
            notes: if installed { "local executable".into() } else { "not installed yet".into() },
        }
    }).collect()
}
