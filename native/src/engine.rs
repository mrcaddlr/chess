use serde::Serialize;
use std::{io::{BufRead,BufReader,Write},path::{Path,PathBuf},process::{Child,Command,Stdio},time::{Duration,Instant}};

#[derive(Clone,Debug,Serialize)]
pub struct EngineInfo {
    pub id:String,pub name:String,pub kind:String,pub path:Option<String>,
    pub installed:bool,pub healthy:bool,pub supports_threads:bool,pub supports_hash:bool,pub notes:String,
}

#[derive(Clone,Debug)]
struct EngineDef {
    id:&'static str,name:&'static str,kind:&'static str,relative_path:&'static str,
    supports_threads:bool,supports_hash:bool,
}

const ENGINES:&[EngineDef]=&[
    EngineDef{id:"sf19-full-single",name:"Stockfish 19 · Full · Single",kind:"stockfish",relative_path:".chess-lab/stockfish-19",supports_threads:false,supports_hash:true},
    EngineDef{id:"sf19-full-multi",name:"Stockfish 19 · Full · Multi",kind:"stockfish",relative_path:".chess-lab/stockfish-19",supports_threads:true,supports_hash:true},
];

fn executable(root:&Path,def:&EngineDef)->PathBuf{root.join(def.relative_path)}

fn probe(path:&Path)->bool{
    let mut child=match Command::new(path).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn(){Ok(c)=>c,Err(_)=>return false};
    let Some(mut stdin)=child.stdin.take() else{let _=child.kill();return false};
    let Some(stdout)=child.stdout.take() else{let _=child.kill();return false};
    let mut reader=BufReader::new(stdout);
    let _=stdin.write_all(b"uci\n");let _=stdin.flush();
    let deadline=Instant::now()+Duration::from_secs(3);let mut line=String::new();
    let mut ok=false;
    while Instant::now()<deadline{
        line.clear();
        match reader.read_line(&mut line){Ok(0)|Err(_)=>break,Ok(_) if line.trim()=="uciok"=>{ok=true;break},Ok(_)=>{}}
    }
    let _=child.kill();ok
}

pub fn list(root:&Path)->Vec<EngineInfo>{
    ENGINES.iter().map(|def|{
        let path=executable(root,def);let installed=path.is_file();
        EngineInfo{id:def.id.into(),name:def.name.into(),kind:def.kind.into(),
            path:installed.then(||path.display().to_string()),installed,
            healthy:installed&&probe(&path),supports_threads:def.supports_threads,supports_hash:def.supports_hash,
            notes:if installed{"official Stockfish 19 binary".into()}else{"provisioning required".into()}}
    }).collect()
}

pub struct EngineSession{child:Child,stdin:std::process::ChildStdin,reader:BufReader<std::process::ChildStdout>,threads:u32}

impl EngineSession{
    pub fn new(root:&Path,engine_id:&str,threads:u32)->Result<Self,String>{
        let def=ENGINES.iter().find(|d|d.id==engine_id).ok_or_else(||format!("unknown engine: {engine_id}"))?;
        let path=executable(root,def);if !path.is_file(){return Err(format!("engine not installed: {}",path.display()));}
        let mut child=Command::new(path).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e|format!("spawn engine: {e}"))?;
        let stdin=child.stdin.take().ok_or("engine stdin unavailable")?;
        let stdout=child.stdout.take().ok_or("engine stdout unavailable")?;
        let mut s=Self{child,stdin,reader:BufReader::new(stdout),threads:threads.max(1)};
        s.send("uci")?;s.wait_for("uciok",Duration::from_secs(8))?;
        if def.supports_threads{s.send(&format!("setoption name Threads value {}",s.threads.min(64)))?;}
        s.send("setoption name Hash value 128")?;s.send("isready")?;s.wait_for("readyok",Duration::from_secs(8))?;
        Ok(s)
    }
    fn send(&mut self,line:&str)->Result<(),String>{self.stdin.write_all(line.as_bytes()).and_then(|_|self.stdin.write_all(b"\n")).and_then(|_|self.stdin.flush()).map_err(|e|e.to_string())}
    fn wait_for(&mut self,wanted:&str,timeout:Duration)->Result<(),String>{
        let deadline=Instant::now()+timeout;let mut line=String::new();
        while Instant::now()<deadline{line.clear();match self.reader.read_line(&mut line){Ok(0)=>return Err("engine exited".into()),Err(e)=>return Err(format!("engine read: {e}")),Ok(_)=>if line.trim()==wanted{return Ok(())}}}
        Err(format!("engine timed out waiting for {wanted}"))
    }
    pub fn best_move(&mut self,fen:&str,depth:u8,allowed_moves:&[String])->Result<String,String>{
        self.send("ucinewgame")?;self.send(&format!("position fen {fen}"))?;
        if allowed_moves.is_empty(){self.send(&format!("go depth {}",depth.clamp(1,30)))?}
        else{self.send(&format!("go depth {} searchmoves {}",depth.clamp(1,30),allowed_moves.join(" ")))?}
        let deadline=Instant::now()+Duration::from_secs(45);let mut line=String::new();
        while Instant::now()<deadline{
            line.clear();
            match self.reader.read_line(&mut line){Ok(0)=>break,Err(e)=>return Err(format!("engine read: {e}")),Ok(_)=>{
                if let Some(rest)=line.trim().strip_prefix("bestmove "){return rest.split_whitespace().next().map(str::to_owned).ok_or_else(||"engine returned empty bestmove".into());}
            }}
        }
        let _=self.send("stop");Err("engine timed out without bestmove".into())
    }
}

impl Drop for EngineSession{fn drop(&mut self){let _=self.send("quit");let _=self.child.kill();}}

pub fn best_move(root:&Path,engine_id:&str,fen:&str,depth:u8,allowed_moves:&[String],threads:u32)->Result<String,String>{
    let mut session=EngineSession::new(root,engine_id,threads)?;session.best_move(fen,depth,allowed_moves)
}

pub fn default_engine_id()->&'static str{"sf19-full-single"}
