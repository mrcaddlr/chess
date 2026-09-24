#!/usr/bin/env node
/* Native Chess Lab learner + optional native Stockfish evaluator. */
const fs=require('fs'),vm=require('vm'),readline=require('readline'),cp=require('child_process'),os=require('os'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
global.navigator={userAgent:'ChessLabNode',hardwareConcurrency:Math.max(1,os.cpus().length),deviceMemory:0};
global.window=undefined; global.document={getElementById:()=>null}; global.self=global;
global.importScripts=(...paths)=>{for(const p of paths){const file=path.resolve(ROOT,p);vm.runInThisContext(fs.readFileSync(file,'utf8'),{filename:file})}};
importScripts('js/chess.js','js/repetition.js','js/core.js','js/learner.js');

let brain=null,replay=[],initialized=false,cancelRequested=false,pauseRequested=false,generation=0,gamesCompleted=0,currentConfig=null;
let lastEvaluation=null;
let perfStats={games:0,positions:0,inferenceMs:0,trainingMs:0,stockfishMs:0,startedAt:0};
const replayXCache=new WeakMap();
const CHECKPOINT_VERSION=2;
function out(o){process.stdout.write(JSON.stringify(o)+"\n")}
function terminal(c){if(isCheckmate(c))return c.turn()==="w"?-1:1;if(isStalemate(c)||isInsufficientMaterial(c))return 0;const f=c.fen().split(" ");return Number(f[4])>=100?0:null}
async function yieldNow(){await new Promise(r=>setImmediate(r));while(pauseRequested&&!cancelRequested){out({type:"paused",phase:"paused",generation,gamesCompleted});await new Promise(r=>setTimeout(r,150));}}
function commandExists(cmd){try{const p=cp.spawnSync(cmd,["--version"],{stdio:"ignore"});return p.status===0||p.error===undefined}catch(e){return false}}
function candidatePaths(){
  const list=(process.env.CHESS_LAB_STOCKFISH||"").split(path.delimiter).filter(Boolean);
  list.push(path.join(ROOT,".chess-lab","stockfish-19"));
  list.push(path.join(ROOT,".chess-lab","stockfish"));
  list.push("stockfish","stockfish-ubuntu","stockfish.exe");
  return [...new Set(list)];
}
function detectStockfish(){
  for(const candidate of candidatePaths()){
    if((candidate.includes(path.sep)||candidate.startsWith(".")) && !fs.existsSync(candidate))continue;
    if(commandExists(candidate))return candidate;
  }
  return null;
}
const stockfishPath=detectStockfish();
let stockfishIdentity={available:false,version:null,name:null,path:stockfishPath,error:stockfishPath?null:"Stockfish 19 executable not found"};
function stockfishProbe(){
  return new Promise(resolve=>{
    if(!stockfishPath)return resolve(stockfishIdentity);
    const p=cp.spawn(stockfishPath,[],{stdio:["pipe","pipe","pipe"]});let buf="",name="",version="";
    const timer=setTimeout(()=>{try{p.kill()}catch(e){};resolve({...stockfishIdentity,error:"Stockfish UCI probe timed out"})},6000);
    p.stdout.on("data",b=>{
      buf+=b.toString();const lines=buf.split(/\r?\n/);buf=lines.pop();
      for(const line of lines){
        if(line.startsWith("id name "))name=line.slice(8).trim();
        if(line.startsWith("id version "))version=line.slice(11).trim();
        if(line==="uciok"){clearTimeout(timer);try{p.kill()}catch(e){};const ok=/Stockfish/i.test(name)&&/\\b19(?:\\.|$)/.test(version||name);resolve({available:ok,version:version||null,name:name||null,path:stockfishPath,error:ok?null:"Stockfish 19 is required; detected "+(name||"unknown engine")+" "+(version||"")});return}
      }
    });
    p.on("error",e=>{clearTimeout(timer);resolve({...stockfishIdentity,error:e.message})});
  });
}
function uciRequest(fen,depth,threads=1){
  return new Promise(async(resolve,reject)=>{
    if(!stockfishIdentity.available)stockfishIdentity=await stockfishProbe();
    const info=stockfishIdentity;
    if(!info.available)return reject(new Error(info.error||"Stockfish 19 is not available"));
    const p=cp.spawn(info.path,[],{stdio:["pipe","pipe","pipe"]});let buf="",done=false,best=null;
    const finish=(err,val)=>{if(done)return;done=true;try{p.kill()}catch(e){};err?reject(err):resolve(val)};
    const timer=setTimeout(()=>finish(new Error("Stockfish UCI timeout")),Math.max(15000,Number(depth||8)*2500));
    p.stdout.on("data",b=>{buf+=b.toString();const lines=buf.split(/\r?\n/);buf=lines.pop();for(const line of lines){if(line.startsWith("bestmove ")){best=line.split(/\\s+/)[1]||null;clearTimeout(timer);finish(null,best);return}}});
    p.on("error",e=>{clearTimeout(timer);finish(e)});p.on("exit",()=>{if(!done){clearTimeout(timer);finish(null,best)}});
    const t=Math.max(1,Math.min(64,Number(threads)||1));
    p.stdin.write("uci\nsetoption name Threads value "+t+"\nisready\nucinewgame\nposition fen "+fen+"\ngo depth "+Math.max(1,Math.min(30,Number(depth)||8))+"\n");
  });
}
async function playTrainingGame(g,maxPlies,sims,opponent,mixRatio,stockfishDepth,stockfishThreads){
  const gameStarted=Date.now();
  const useStockfish=opponent==="stockfish"||(opponent==="mix"&&((g*100/Math.max(1,currentConfig.games))<mixRatio));
  const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false},local=[];const searchState={root:null,rootKey:null,pendingKey:null,transpositions:new Map()};let p=0;
  while(!terminalPosition(c)&&!state.forcedDraw&&p<maxPlies&&!cancelRequested){
    await yieldNow();if(cancelRequested)break;
    const legal=safeRepetitionMoves(c,hist);if(!legal.length)break;
    const learnerTurn=useStockfish?(c.turn()==="w"?g%2===0:g%2!==0):true;
    let moveResult;
    if(useStockfish&&!learnerTurn){
      const sfStart=Date.now();const uci=await uciRequest(c.fen(),stockfishDepth,stockfishThreads);perfStats.stockfishMs+=Date.now()-sfStart;
      const engineMove=legal.find(m=>m.from+m.to+(m.promotion||"")===uci)||legal[0];
      moveResult={move:engineMove,policy:[{a:actionIndex(engineMove),p:1}]};
    }else moveResult=await mcts(c,sims,brain,true,searchState);
    if(!moveResult?.move)break;
    const safe=safeRepetitionMove(c,moveResult.move,brain,hist,state);if(safe.forcedDraw||!safe.move)break;
    if(learnerTurn)local.push({x:Array.from(encode(c)),action:actionIndex(safe.move),legal:legal.map(actionIndex),policy:moveResult.policy||[{a:actionIndex(safe.move),p:1}],side:c.turn()});
    if(!c.move({from:safe.move.from,to:safe.move.to,promotion:safe.move.promotion}))break;
    p++;recordPosition(c,hist);
    positionsForProgress++;
    if((p&3)===0)await yieldNow();
  }
  let result=terminal(c);if(result===null)result=0;
  for(const s of local)replay.push({...s,reward:s.side==="w"?result:-result});
  perfStats.games++;perfStats.positions+=local.length;
  return {samples:local.length,plies:p,fen:c.fen(),result,useStockfish,durationMs:Date.now()-gameStarted};
}
let positionsForProgress=0;
async function selfPlay(requestedGames,maxPlies,sims,opponent="self",mixRatio=25,stockfishDepth=8,stockfishThreads=1,parallelGames=1){
  let samples=0;positionsForProgress=0;
  for(let base=0;base<requestedGames&&!cancelRequested;base+=Math.max(1,parallelGames)){
    const batch=[];for(let g=base;g<Math.min(requestedGames,base+Math.max(1,parallelGames));g++)batch.push(playTrainingGame(g,maxPlies,sims,opponent,mixRatio,stockfishDepth,stockfishThreads));
    const results=await Promise.all(batch);
    results.forEach((r,i)=>{samples+=r.samples;out({type:"progress",phase:"self-play",game:base+i+1,totalGames:requestedGames,positions:positionsForProgress,plies:r.plies});out({type:"live",phase:"self-play",game:base+i+1,totalGames:requestedGames,positions:positionsForProgress,plies:r.plies,fen:r.fen,turn:(r.fen.split(" ")[1]||"w")})});
  }
  const replayLimit=Math.max(1000,Number(currentConfig?.replaySize||50000));if(replay.length>replayLimit)replay=replay.slice(-replayLimit);
  return {samples,positions:positionsForProgress};
}
async function train(updates,lr,batchSize){
  let total=0,used=0;
  for(let i=0;i<updates&&!cancelRequested;i++){
    await yieldNow();if(!replay.length)break;
    const batch=Math.max(1,Math.min(batchSize,replay.length));let loss=0;
    for(let j=0;j<batch;j++){const s=replay[(Math.random()*replay.length)|0];if(!s?.legal?.length)continue;let x=replayXCache.get(s);if(!x){x=Float32Array.from(s.x||[]);replayXCache.set(s,x)}const t0=Date.now();loss+=brain.trainPolicyValue(x,s.policy,s.reward,s.legal,lr);perfStats.trainingMs+=Date.now()-t0;used++;}
    total+=loss/Math.max(1,batch);
    if((i&3)===3)out({type:"progress",phase:"training",update:i+1,totalUpdates:updates,loss:used?total/Math.max(1,Math.ceil(used/batch)):0,positions:replay.length});
  }
  return used?total/Math.max(1,Math.ceil(used/Math.max(1,batchSize))):0;
}
async function learnerMove(c,sims){const legal=safeRepetitionMoves(c,newRepetitionHistory(c));if(!legal.length)return null;const result=await mcts(c,sims,brain,true);return result?.move||legal[0]}
async function evaluateAgainstStockfish(games,plies,sims,depth,threads){
  const info=await stockfishProbe();stockfishIdentity=info;if(!info.available)return {available:false,games:0,wins:0,draws:0,losses:0,error:info.error||"Stockfish 19 unavailable"};
  let wins=0,draws=0,losses=0,played=0;
  for(let g=0;g<games&&!cancelRequested;g++){
    const learnerWhite=g%2===0,c=new Chess(),hist=newRepetitionHistory(c);let p=0;
    while(!terminalPosition(c)&&p<plies&&!cancelRequested){
      await yieldNow();let move;
      if((c.turn()==="w")===learnerWhite)move=await learnerMove(c,currentConfig?.sims||sims);
      else{const uci=await uciRequest(c.fen(),depth,threads);const legal=c.moves({verbose:true});move=legal.find(m=>m.from+m.to+(m.promotion||"")===uci)||legal[0]}
      if(!move||!c.move({from:move.from,to:move.to,promotion:move.promotion}))break;p++;recordPosition(c,hist);
    }
    let r=terminal(c);if(r===null)r=0;const learnerResult=learnerWhite?r:-r;if(learnerResult>0)wins++;else if(learnerResult<0)losses++;else draws++;played++;
    out({type:"evaluation-progress",phase:"stockfish-eval",game:played,totalGames:games,wins,draws,losses});
  }
  const score=played?(wins+draws*.5)/played:0;
  return {available:true,version:stockfishIdentity.version,name:stockfishIdentity.name,games:played,wins,draws,losses,score,estimatedElo:Math.round(500+score*1900)};
}
function checkpointPayload(){
  return {version:CHECKPOINT_VERSION,generation,gamesCompleted,brain:brain?.toJSON?.()||null,replay:replay.slice(-Math.min(replay.length,5000)),replaySize:replay.length,updatedAt:new Date().toISOString()};
}
function checkpointFile(){
  const file=path.join(ROOT,".chess-lab-checkpoint.json"),tmp=file+".tmp";
  fs.writeFileSync(tmp,JSON.stringify(checkpointPayload()));
  fs.renameSync(tmp,file);
  return file;
}
async function handle(d){
  if(d.type==="stop"){cancelRequested=true;pauseRequested=false;return}
  if(d.type==="pause"){pauseRequested=true;out({type:"paused",phase:"paused",generation});return}
  if(d.type==="resume"){pauseRequested=false;out({type:"resumed",phase:"resuming",generation});return}
  if(d.type==="checkpoint"){const file=checkpointFile();out({type:"checkpoint",checkpoint:{...checkpointPayload(),file}});return}
  if(d.type==="init"){
    let checkpoint=null;
    if(d.resumeCheckpoint){try{checkpoint=JSON.parse(fs.readFileSync(path.join(ROOT,".chess-lab-checkpoint.json"),"utf8"))}catch(e){}}
    brain=checkpoint?.brain?TinyNet.fromJSON(checkpoint.brain):(d.brain?TinyNet.fromJSON(d.brain):new TinyNet(Date.now()));
    replay=Array.isArray(checkpoint?.replay)?checkpoint.replay:(Array.isArray(d.replay)?d.replay:[]);
    generation=Number(checkpoint?.generation ?? d.generation)||0;gamesCompleted=Number(checkpoint?.gamesCompleted ?? d.gamesCompleted)||0;initialized=true;
    stockfishIdentity=await stockfishProbe();out({type:"ready",generation,gamesCompleted,stockfish:stockfishIdentity.available,stockfishInfo:stockfishIdentity});return;
  }
  if(d.type==="stockfish-info"){stockfishIdentity=await stockfishProbe();out({type:"stockfish-info",...stockfishIdentity});return}
  if(d.type!=="train"||!initialized)throw new Error("native trainer is not initialized");
  cancelRequested=false;
  perfStats={games:0,positions:0,inferenceMs:0,trainingMs:0,stockfishMs:0,startedAt:Date.now()};
  const requestedGames=Math.max(1,Number(d.games||d.gamesPerGeneration)||1),maxPlies=Math.max(20,Number(d.maxPlies)||160),sims=Math.max(1,Math.min(128,Number(d.sims)||8)),updates=Math.max(1,Number(d.updates)||Math.min(requestedGames*8,512)),lr=Math.max(.00001,Math.min(.01,Number(d.lr)||.001)),batchSize=Math.max(1,Math.min(512,Number(d.batchSize)||64)),parallelGames=1,stockfishThreads=Math.max(1,Math.min(64,Number(d.stockfishThreads)||1));
  currentConfig={...d,games:requestedGames,replaySize:Number(d.replaySize)||50000,opponent:d.opponent||"self",mixRatio:Number(d.mixRatio)||25,stockfishDepth:Number(d.stockfishDepth)||12,sims,batchSize,parallelGames,stockfishThreads};
  const samples=await selfPlay(requestedGames,maxPlies,sims,currentConfig.opponent,currentConfig.mixRatio,currentConfig.stockfishDepth,stockfishThreads,parallelGames);
  const loss=await train(updates,lr,batchSize);
  let evaluation=null;
  if(!cancelRequested&&d.stockfishEval!==false)evaluation=await evaluateAgainstStockfish(Math.max(1,Math.min(100,Number(d.evalGames)||10)),Math.max(20,Number(d.evalPlies)||300),sims,Math.max(1,Math.min(30,Number(d.stockfishDepth)||12)),stockfishThreads);
  if(!cancelRequested){generation++;gamesCompleted+=requestedGames;lastEvaluation=evaluation}
  const checkpoint=checkpointPayload();if(!cancelRequested){try{checkpointFile()}catch(e){out({type:"warning",message:"checkpoint save failed: "+e.message})}}
  out({type:"complete",performance:{...perfStats,durationMs:Date.now()-perfStats.startedAt},brain:brain.toJSON(),games:cancelRequested?0:requestedGames,positions:samples.samples,replaySize:replay.length,loss,evaluation,cancelled:cancelRequested,generation,gamesCompleted,checkpoint});
}
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
rl.on("line",async line=>{try{await handle(JSON.parse(line))}catch(e){out({type:"error",message:e?.stack||String(e)})}});
