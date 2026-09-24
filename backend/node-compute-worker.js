#!/usr/bin/env node
/* Native Chess Lab learner + optional native Stockfish evaluator. */
const fs=require('fs'),vm=require('vm'),readline=require('readline'),cp=require('child_process'),os=require('os'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
global.navigator={userAgent:'ChessLabNode',hardwareConcurrency:Math.max(1,os.cpus().length),deviceMemory:0};
global.window=undefined; global.document={getElementById:()=>null}; global.self=global;
global.importScripts=(...paths)=>{for(const p of paths){const file=path.resolve(ROOT,p);vm.runInThisContext(fs.readFileSync(file,'utf8'),{filename:file})}};
importScripts('js/chess.js','js/repetition.js','js/core.js','js/learner.js');

let brain=null,replay=[],initialized=false,cancelRequested=false,pauseRequested=false,generation=0,gamesCompleted=0,currentConfig=null;
function advanceTrainingCounters(count){generation=(Number(generation)||0)+1;gamesCompleted=(Number(gamesCompleted)||0)+Number(count||0);}
function out(o){process.stdout.write(JSON.stringify(o)+'\n')}
function terminal(c){if(isCheckmate(c))return c.turn()==='w'?-1:1;if(isStalemate(c)||isInsufficientMaterial(c))return 0;const f=c.fen().split(' ');return Number(f[4])>=100?0:null}
async function yieldNow(){await new Promise(r=>setImmediate(r));while(pauseRequested&&!cancelRequested){out({type:'paused',phase:'paused',generation});await new Promise(r=>setTimeout(r,150));}}
function findStockfish(){
  const candidates=(process.env.CHESS_LAB_STOCKFISH||'').split(path.delimiter).filter(Boolean);
  candidates.push('stockfish','stockfish-ubuntu','stockfish.exe');
  for(const x of candidates){
    try{const p=cp.spawnSync(x,['--version'],{stdio:'ignore'});if(p.status===0||p.error===undefined)return x}catch(e){}
  }
  return null;
}
const stockfishPath=findStockfish();
function uciRequest(fen,depth){
  return new Promise((resolve,reject)=>{
    if(!stockfishPath)return reject(new Error('Stockfish executable not found on the PC'));
    const p=cp.spawn(stockfishPath,[],{stdio:['pipe','pipe','pipe']});
    let buf='',done=false,best=null;
    const finish=(err,val)=>{if(done)return;done=true;try{p.kill()}catch(e){};err?reject(err):resolve(val)};
    const timer=setTimeout(()=>finish(new Error('Stockfish UCI timeout')),Math.max(15000,depth*2500));
    p.stdout.on('data',b=>{
      buf+=b.toString(); const lines=buf.split(/\r?\n/); buf=lines.pop();
      for(const line of lines){
        if(line.startsWith('bestmove ')){best=line.split(/\s+/)[1]||null;clearTimeout(timer);finish(null,best);return}
      }
    });
    p.on('error',e=>{clearTimeout(timer);finish(e)});
    p.on('exit',()=>{if(!done){clearTimeout(timer);finish(null,best)}});
    p.stdin.write('uci\n');p.stdin.write('isready\n');p.stdin.write('ucinewgame\n');p.stdin.write('position fen '+fen+'\n');p.stdin.write('go depth '+Math.max(1,Math.min(20,depth||8))+'\n');
  });
}
async function selfPlay(requestedGames,maxPlies,sims){
  const all=[];let positions=0;
  for(let g=0;g<requestedGames&&!cancelRequested;g++){
    const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false},local=[];let p=0;
    while(!terminalPosition(c)&&!state.forcedDraw&&p<maxPlies&&!cancelRequested){
      const legal=safeRepetitionMoves(c,hist);if(!legal.length)break;
      const result=await mcts(c,sims,brain,true);if(!result?.move)break;
      const safe=safeRepetitionMove(c,result.move,brain,hist,state);if(safe.forcedDraw||!safe.move)break;
      local.push({x:Array.from(encode(c)),action:actionIndex(safe.move),legal:legal.map(actionIndex),policy:result.policy||[{a:actionIndex(safe.move),p:1}],side:c.turn()});
      if(!c.move({from:safe.move.from,to:safe.move.to,promotion:safe.move.promotion}))break;
      p++;recordPosition(c,hist);out({type:'live',phase:'self-play',game:g+1,totalGames:requestedGames,positions:positions+p,plies:p,fen:c.fen(),turn:c.turn()});if((p&3)===0)await yieldNow();
    }
    let r=terminal(c);if(r===null)r=0;for(const s of local)all.push({...s,reward:s.side==='w'?r:-r});
    positions+=local.length;out({type:'progress',phase:'self-play',game:g+1,totalGames:requestedGames,positions,plies:p});
  }
  replay.push(...all);if(replay.length>50000)replay=replay.slice(-50000);return all;
}
async function train(updates,lr){
  let total=0,used=0;
  for(let i=0;i<updates&&!cancelRequested;i++){
    if(!replay.length)break;const s=replay[(Math.random()*replay.length)|0];if(!s?.legal?.length)continue;
    const loss=brain.trainPolicyValue(Float32Array.from(s.x),s.policy,s.reward,s.legal,lr);total+=loss;used++;
    if((i&3)===3)out({type:'progress',phase:'training',update:i+1,totalUpdates:updates,loss:used?total/used:0,positions:replay.length});
    if((i&31)===31)await yieldNow();
  } return used?total/used:0;
}
async function learnerMove(c,sims){
  const legal=safeRepetitionMoves(c,newRepetitionHistory(c));if(!legal.length)return null;
  const result=await mcts(c,sims,brain,true);return result?.move||legal[0];
}
async function evaluateAgainstStockfish(games,plies,sims,depth){
  if(!stockfishPath)return {available:false,games:0,wins:0,draws:0,losses:0,error:'Stockfish executable not found'};
  let wins=0,draws=0,losses=0,played=0;
  for(let g=0;g<games&&!cancelRequested;g++){
    const learnerWhite=g%2===0,c=new Chess(),hist=newRepetitionHistory(c);let p=0;
    while(!terminalPosition(c)&&p<plies&&!cancelRequested){
      let move;
      if((c.turn()==='w')===learnerWhite) move=await learnerMove(c,sims);
      else {const uci=await uciRequest(c.fen(),depth);const legal=c.moves({verbose:true});move=legal.find(m=>m.from+m.to+(m.promotion||'')===uci)||legal[0]}
      if(!move||!c.move({from:move.from,to:move.to,promotion:move.promotion}))break;
      p++;recordPosition(c,hist);
    }
    let r=terminal(c);if(r===null)r=0;
    const learnerResult=learnerWhite?r:-r;if(learnerResult>0)wins++;else if(learnerResult<0)losses++;else draws++;played++;
    out({type:'evaluation-progress',phase:'stockfish-eval',game:played,totalGames:games,wins,draws,losses});
  }
  return {available:true,games:played,wins,draws,losses};
}
async function handle(d){
  if(d.type==='stop'){cancelRequested=true;pauseRequested=false;return}
  if(d.type==='pause'){pauseRequested=true;out({type:'paused',phase:'paused'});return}
  if(d.type==='resume'){pauseRequested=false;out({type:'resumed',phase:'resuming'});return}
  if(d.type==='init'){brain=d.brain?TinyNet.fromJSON(d.brain):new TinyNet(Date.now());replay=Array.isArray(d.replay)?d.replay:[];initialized=true;out({type:'ready',generation:Number(d.generation)||0,stockfish:!!stockfishPath,stockfishPath:stockfishPath||null});return}
  if(d.type==='stockfish-info'){out({type:'stockfish-info',available:!!stockfishPath,path:stockfishPath});return}
  if(d.type!=='train'||!initialized)throw new Error('native trainer is not initialized');
  cancelRequested=false;
  const requestedGames=Math.max(1,Number(d.games)||1),maxPlies=Math.max(40,Number(d.maxPlies)||160),sims=Math.max(1,Math.min(128,Number(d.sims)||8)),updates=Math.max(1,Number(d.updates)||Math.min(requestedGames*8,512)),lr=Math.max(.00001,Math.min(.01,Number(d.lr)||.001));currentConfig={games:requestedGames};
  const samples=await selfPlay(requestedGames,maxPlies,sims);const loss=await train(updates,lr);
  let evaluation=null;
  if(!cancelRequested&&d.stockfishEval!==false) evaluation=await evaluateAgainstStockfish(Math.max(1,Math.min(20,Number(d.evalGames)||4)),Math.max(40,Number(d.evalPlies)||120),Math.max(1,Math.min(16,Number(d.evalSims)||sims)),Math.max(4,Math.min(16,Number(d.stockfishDepth)||8)));
  if(!cancelRequested)advanceTrainingCounters(requestedGames);out({type:'complete',brain:brain.toJSON(),games:cancelRequested?0:requestedGames,positions:samples.length,replaySize:replay.length,loss,evaluation,cancelled:cancelRequested,generation:Number(generation)||0});
}
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
rl.on('line',async line=>{try{await handle(JSON.parse(line))}catch(e){out({type:'error',message:e?.stack||String(e)})}});
