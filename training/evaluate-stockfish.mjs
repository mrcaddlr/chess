import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { Chess } from 'chess.js';
import { loadBrain, choosePolicyMove, terminalValue } from './headless.mjs';
import { TRAINING } from './config.mjs';
import { scoreFromResults, performanceElo } from './elo.mjs';

function findStockfish(){
  for(const p of ['/usr/games/stockfish','/usr/bin/stockfish']){
    if(fs.existsSync(p))return p;
  }
  return 'stockfish';
}

class UCI {
  constructor(path){
    this.proc=spawn(path,[],{stdio:['pipe','pipe','inherit']});
    this.buffer='';
    this.waiters=[];
    this.proc.stdout.on('data',d=>{this.buffer+=d.toString();this.flush();});
  }
  flush(){
    const lines=this.buffer.split(/\r?\n/);
    this.buffer=lines.pop()||'';
    for(const line of lines){
      for(let i=0;i<this.waiters.length;i++){
        const w=this.waiters[i];
        if(w.test(line)){this.waiters.splice(i,1);w.resolve(line);break;}
      }
    }
  }
  send(s){this.proc.stdin.write(s+'\n');}
  wait(test,timeout=120000){
    return new Promise((resolve,reject)=>{
      const t=setTimeout(()=>{const i=this.waiters.indexOf(w);if(i>=0)this.waiters.splice(i,1);reject(new Error('Stockfish UCI timeout'));},timeout);
      const w={test,resolve:(line)=>{clearTimeout(t);resolve(line)}};
      this.waiters.push(w);
    });
  }
  async init(){
    this.send('uci'); await this.wait(l=>l==='uciok');
    this.send('isready'); await this.wait(l=>l==='readyok');
  }
  async move(fen,depth){
    this.send('position fen '+fen);
    this.send('go depth '+depth);
    const line=await this.wait(l=>l.startsWith('bestmove '));
    return line.split(/\s+/)[1];
  }
  close(){this.send('quit');this.proc.kill();}
}

function uciToMove(c,uci){
  const legal=c.moves({verbose:true});
  return legal.find(m=>m.from+m.to+(m.promotion||'')===uci)||null;
}

function playMatch(brain,engine,learnerWhite,maxPlies){
  return (async()=>{
    const c=new Chess();
    for(let ply=0;ply<maxPlies&&!c.isGameOver();ply++){
      const learnerTurn=(c.turn()==='w')===learnerWhite;
      let move;
      if(learnerTurn) move=choosePolicyMove(c,brain,0);
      else move=uciToMove(c,await engine.move(c.fen(),TRAINING.stockfishDepth));
      if(!move)break;
      c.move({from:move.from,to:move.to,promotion:move.promotion});
    }
    const tv=terminalValue(c);
    if(tv===0||tv===null)return 0.5;
    const whiteWin=tv===1;
    const learnerWin=learnerWhite===whiteWin;
    return learnerWin?1:0;
  })();
}

const brain=loadBrain(TRAINING.checkpoint);
const generation=Number(brain.toJSON().generation||0);
const engine=new UCI(findStockfish());
await engine.init();

let wins=0,draws=0,losses=0;
const games=TRAINING.evaluationGames;
for(let i=0;i<games;i++){
  const learnerWhite=i%2===0;
  const result=await playMatch(brain,engine,learnerWhite,120);
  if(result===1)wins++;
  else if(result===0.5)draws++;
  else losses++;
}
engine.close();

const score=scoreFromResults(wins,draws,losses);
const elo=performanceElo(score,TRAINING.stockfishRating);
let history=[];
if(fs.existsSync(TRAINING.history))history=JSON.parse(fs.readFileSync(TRAINING.history,'utf8'));
const previous=history.at(-1);
const record={
  generation,
  engine:'Stockfish',
  stockfishRating:TRAINING.stockfishRating,
  stockfishDepth:TRAINING.stockfishDepth,
  games,
  wins,draws,losses,
  score,
  elo,
  previousElo:previous?.elo??null,
  eloChange:previous?elo-previous.elo:null,
  evaluatedAt:new Date().toISOString(),
  status:'complete'
};
history.push(record);
fs.writeFileSync(TRAINING.history,JSON.stringify(history,null,2));
fs.writeFileSync(TRAINING.latestEvaluation,JSON.stringify(record,null,2));

const genFile=TRAINING.generationDir+'/generation-'+String(generation).padStart(6,'0')+'.json';
const gen=fs.existsSync(genFile)?JSON.parse(fs.readFileSync(genFile,'utf8')):{generation};
Object.assign(gen,{evaluation:record,status:'complete'});
fs.writeFileSync(genFile,JSON.stringify(gen,null,2));

console.log(JSON.stringify(record));
