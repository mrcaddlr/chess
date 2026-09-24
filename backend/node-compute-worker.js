#!/usr/bin/env node
/* Chess Lab native learner worker.
   Uses the repository's existing JS chess/learner implementation under Node,
   so the PC can continue training without a browser tab. */
const fs=require('fs'),vm=require('vm'),readline=require('readline');
const ROOT=require('path').resolve(__dirname,'..');
global.navigator={userAgent:'ChessLabNode',hardwareConcurrency:Math.max(1,require('os').cpus().length),deviceMemory:0};
global.window=undefined;
global.document={getElementById:()=>null};
global.self=global;
global.importScripts=(...paths)=>{for(const p of paths){const file=require('path').resolve(ROOT,p);vm.runInThisContext(fs.readFileSync(file,'utf8'),{filename:file})}};
importScripts('js/chess.js','js/repetition.js','js/core.js','js/learner.js');

let brain=null,replay=[],initialized=false;
function out(o){process.stdout.write(JSON.stringify(o)+'\n')}
function terminal(c){if(isCheckmate(c))return c.turn()==='w'?-1:1;if(isStalemate(c)||isInsufficientMaterial(c))return 0;const f=c.fen().split(' ');return Number(f[4])>=100?0:null}
function yieldNow(){return new Promise(r=>setImmediate(r))}
async function selfPlay(games,maxPlies,sims){
  const all=[];let positions=0;
  for(let g=0;g<games;g++){
    const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false},local=[];let p=0;
    while(!terminalPosition(c)&&!state.forcedDraw&&p<maxPlies){
      const legal=safeRepetitionMoves(c,hist);if(!legal.length)break;
      const result=await mcts(c,sims,brain,true);if(!result?.move)break;
      const safe=safeRepetitionMove(c,result.move,brain,hist,state);if(safe.forcedDraw||!safe.move)break;
      local.push({x:Array.from(encode(c)),action:actionIndex(safe.move),legal:legal.map(actionIndex),policy:result.policy||[{a:actionIndex(safe.move),p:1}],side:c.turn()});
      if(!c.move({from:safe.move.from,to:safe.move.to,promotion:safe.move.promotion}))break;
      p++;recordPosition(c,hist);
      if((p&15)===0)await yieldNow();
    }
    let r=terminal(c);if(r===null)r=0;
    for(const s of local)all.push({...s,reward:s.side==='w'?r:-r});
    positions+=local.length;
    out({type:'progress',phase:'self-play',game:g+1,totalGames:games,positions,plies:p});
  }
  replay.push(...all);
  const maxReplay=50000;if(replay.length>maxReplay)replay=replay.slice(-maxReplay);
  return all;
}
async function train(updates,lr){
  let total=0,used=0;
  for(let i=0;i<updates;i++){
    if(!replay.length)break;
    const s=replay[(Math.random()*replay.length)|0];
    if(!s||!s.legal?.length)continue;
    const loss=brain.trainPolicyValue(Float32Array.from(s.x),s.policy,s.reward,s.legal,lr);
    total+=loss;used++;
    if((i&15)===15)out({type:'progress',phase:'training',update:i+1,totalUpdates:updates,loss:used?total/used:0});
    if((i&31)===31)await yieldNow();
  }
  return used?total/used:0;
}
async function handle(d){
  if(d.type==='init'){
    brain=d.brain?TinyNet.fromJSON(d.brain):new TinyNet(Date.now());
    replay=Array.isArray(d.replay)?d.replay:[];
    initialized=true;out({type:'ready',generation:Number(d.generation)||0});return;
  }
  if(d.type!=='train'||!initialized)throw new Error('native trainer is not initialized');
  const games=Math.max(1,Number(d.games)||1),maxPlies=Math.max(40,Number(d.maxPlies)||160),sims=Math.max(1,Math.min(64,Number(d.sims)||4)),updates=Math.max(1,Number(d.updates)||Math.min(games*8,512)),lr=Math.max(.0001,Math.min(.01,Number(d.lr)||.0015));
  const samples=await selfPlay(games,maxPlies,sims);
  const loss=await train(updates,lr);
  const meta=brain.toJSON();
  out({type:'complete',brain:meta,games,positions:samples.length,replaySize:replay.length,loss});
}
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
rl.on('line',async line=>{try{const d=JSON.parse(line);await handle(d)}catch(e){out({type:'error',message:e?.stack||String(e)})}});
