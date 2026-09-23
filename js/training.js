/* Reinforcement learning · parallel self-play + engine curriculum */
function trainReplay(n=CONFIG.rlBatch,lr=CONFIG.lr){
  if(!brain||!replay.length)return 0;
  let total=0,used=0;
  const len=replay.length,recentStart=Math.max(0,len-Math.min(5000,len));
  for(let i=0;i<n;i++){
    // Mix the long-term buffer with recent experience so learning does not collapse
    // onto the latest generation while still adapting to new behavior.
    const useRecent=(i%4===0);
    const lo=useRecent?recentStart:0,span=useRecent?len-recentStart:len;
    const s=replay[lo+((Math.random()*Math.max(1,span))|0)];
    if(!s||!Array.isArray(s.legal)||!s.legal.length)continue;
    total+=s.policy?.length?brain.trainPolicyValue(Float32Array.from(s.x),s.policy,s.reward,s.legal,lr):brain.trainRL(Float32Array.from(s.x),s.action,s.reward,s.legal,lr);
    used++;
  }
  if(used)steps+=used;
  window.lastTrainingLoss=used?total/used:0;
  return used?total/used:0;
}
function trainingPolicyMove(c,hist,state){const legal=safeRepetitionMoves(c,hist);if(!legal.length)return null;const proposed=softmaxLegal(c,.9,brain),safe=safeRepetitionMove(c,proposed,brain,hist,state);return safe.forcedDraw?null:safe.move}
async function trainAgainstEngineGame(maxPlies=120,depth=5){if(!stockfishReady)throw new Error('Stockfish is not ready. Load Stockfish first.');const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false},samples=[],learnerWhite=Math.random()<.5;let plies=0;while(!terminalPosition(c)&&!state.forcedDraw&&plies<maxPlies&&!cancelRequested){const learnerTurn=(c.turn()==='w')===learnerWhite;let move=learnerTurn?trainingPolicyMove(c,hist,state):await stockfishMove(c,depth,safeRepetitionMoves(c,hist));if(!move)break;if(learnerTurn)samples.push({x:Array.from(encode(c)),action:actionIndex(move),legal:safeRepetitionMoves(c,hist).map(actionIndex)});if(moveCreatesRepetitionBreak(c,move,hist)){const safe=safeRepetitionMove(c,move,brain,hist,state);if(safe.forcedDraw)break;move=safe.move}if(!c.move({from:move.from,to:move.to,promotion:move.promotion}))break;plies++;recordPosition(c,hist);if((plies&15)===0)await new Promise(r=>setTimeout(r,0))}let result=terminalValue(c);if(result===null)result=0;const learnerResult=learnerWhite?result:-result;for(const s of samples)s.reward=learnerResult;return {samples,result:learnerResult,moves:plies,source:'stockfish'}}
function appendSamples(samples){
  if(!Array.isArray(samples)||!samples.length)return;
  for(const s of samples)if(s&&Array.isArray(s.legal)&&s.legal.length)replay.push(s);
  if(replay.length>CONFIG.replayMax)replay.splice(0,replay.length-CONFIG.replayMax);
}
async function browserSelfPlayGame(maxPlies=120){
  const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false},samples=[];
  let plies=0;
  while(!terminalPosition(c)&&!state.forcedDraw&&plies<maxPlies&&!cancelRequested){
    const legal=safeRepetitionMoves(c,hist);
    if(!legal.length)break;
    const proposed=await learnerMove(c,Math.max(1,Math.min(8,Number(document.getElementById('sims')?.value)||4)),brain,hist);
    if(!proposed)break;
    const move=safeRepetitionMove(c,proposed,brain,hist,state);
    if(move.forcedDraw||!move.move)break;
    const chosen=move.move;
    samples.push({x:Array.from(encode(c)),action:actionIndex(chosen),legal:legal.map(actionIndex),side:c.turn()});
    if(!c.move({from:chosen.from,to:chosen.to,promotion:chosen.promotion}))break;
    plies++;
    recordPosition(c,hist);
    if((plies&7)===0)await new Promise(r=>setTimeout(r,0));
  }
  let r=terminalValue(c);if(r===null)r=0;
  for(const s of samples)s.reward=s.side==='w'?r:-r;
  return {samples,games:1,moves:plies};
}
async function runParallelSelfPlay(gameCount,maxPlies){
  const requested=Math.max(1,Number(gameCount)||1);
  const workers=Math.max(1,Math.min(requested,(navigator.hardwareConcurrency||2)-1));
  if(typeof Worker!=='undefined'&&workers>=2){
    try{
      const per=Math.ceil(requested/workers),payload=brain.toJSON();
      stopFastWorkers();
      return await new Promise((resolve,reject)=>{
        let done=0,all=[],expected=0;
        for(let i=0;i<workers;i++){
          const gamesForWorker=Math.min(per,Math.max(0,requested-i*per));
          if(!gamesForWorker)continue;
          expected++;
          const w=new Worker('js/training-worker.js?v=0.14.0');
          fastWorkers.push(w);
          let finished=false;
          const cleanup=()=>{try{w.terminate()}catch(e){}};
          w.onmessage=e=>{
            const d=e.data||{};
            if(d.type==='batch'&&!finished){
              finished=true;done++;all.push(...(d.samples||[]));cleanup();
              if(done===expected)resolve({samples:all,games:requested,workers});
            }else if(d.type==='error'&&!finished){
              finished=true;cleanup();reject(new Error(d.message||'training worker failed'));
            }
          };
          w.onerror=e=>{if(!finished){finished=true;cleanup();reject(new Error(e.message||'training worker crashed'))}};
          w.postMessage({type:'train',brain:payload,games:gamesForWorker,maxPlies,sims:Math.max(1,Math.min(8,Number(document.getElementById('sims')?.value)||4))});
        }
      });
    }catch(e){
      log('worker self-play unavailable · using browser fallback: '+e.message);
      stopFastWorkers();
    }
  }
  const all=[];for(let g=0;g<requested&&!cancelRequested;g++){
    const r=await browserSelfPlayGame(maxPlies);all.push(...r.samples);
    setStatus('training','browser self-play · '+(g+1)+' / '+requested+' games',Math.round((g+1)/requested*100));
  }
  return {samples:all,games:requested,workers:1};
}
async function evaluateGenerationAgainstStockfish(games=8,depth=5){
  if(!stockfishReady||!stockfishWorker)return null;
  let wins=0,draws=0,losses=0;
  for(let i=0;i<games&&!cancelRequested;i++){
    const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false};
    const learnerWhite=i%2===0;let plies=0;
    while(!terminalPosition(c)&&!state.forcedDraw&&plies<120&&!cancelRequested){
      const learnerTurn=(c.turn()==='w')===learnerWhite;
      const legal=safeRepetitionMoves(c,hist);
      if(!legal.length)break;
      let move=learnerTurn?await learnerMove(c,Math.max(1,Math.min(8,Number(document.getElementById('sims')?.value)||4)),brain,hist):await stockfishMove(c,depth,legal);
      if(!move)break;
      const safe=safeRepetitionMove(c,move,learnerTurn?brain:null,hist,state);
      if(safe.forcedDraw||!safe.move)break;
      move=safe.move;
      if(!c.move({from:move.from,to:move.to,promotion:move.promotion}))break;
      plies++;recordPosition(c,hist);
      if((plies&7)===0)await new Promise(r=>setTimeout(r,0));
    }
    const r=terminalValue(c);
    if(r===null||r===0)draws++;
    else if((learnerWhite&&r>0)||(!learnerWhite&&r<0))wins++;
    else losses++;
    setStatus('evaluating','Stockfish benchmark · game '+(i+1)+' / '+games,Math.round((i+1)/games*100));
  }
  const total=wins+draws+losses,score=total?(wins+.5*draws)/total:.5;
  const elo=Math.round(3500+400*Math.log10(Math.max(.01,Math.min(.99,score))/(1-Math.max(.01,Math.min(.99,score)))));
  evalRecord={generation,engine:'Stockfish',games:total,wins,draws,losses,score,elo,eloChange:null};
  estimatedElo=elo;
  log('generation '+generation+' · Stockfish '+wins+'W '+draws+'D '+losses+'L · estimated Elo '+elo);
  return evalRecord;
}

async function calibrateTrainingElo(){if(!stockfishReady||cancelRequested)return null;const anchors=[1320,1500,1800],scores=[];for(const anchor of anchors){if(cancelRequested)break;try{stockfishWorker.postMessage('setoption name UCI_LimitStrength value true');stockfishWorker.postMessage('setoption name UCI_Elo value '+anchor)}catch(e){}const r=await trainAgainstEngineGame(70,4);scores.push(r.result>0?1:r.result<0?0:.5)}if(!scores.length)return null;return Math.round(1320+(scores.reduce((a,b)=>a+b,0)/scores.length)*480)}
async function trainBatch(){if(training)return;cancelRequested=false;training=true;busy=false;const requested=Math.max(1,Math.min(1000,Number(document.getElementById('batchGames').value)||32)),batch=Math.max(2,Math.min(256,Number(document.getElementById('parallelGames').value)||64)),lr=Math.max(.0001,Math.min(.01,Number(document.getElementById('mutationRate').value)||CONFIG.lr)),updates=Math.max(1,Math.min(256,Number(document.getElementById('evalMatches').value)||CONFIG.rlBatch)),maxPlies=Math.max(40,Math.min(500,Number(document.getElementById('trainSims').value)||CONFIG.trainPlies)),mode=document.getElementById('trainingMode')?.value||'games',source=document.getElementById('trainOpponent')?.value||'self';trainingTargetElo=Math.max(400,Math.min(2400,Number(document.getElementById('targetElo')?.value)||1000));if(mode==='target'&&source==='self'){training=false;toast('target Elo mode needs an engine benchmark');setStatus('ready','choose Stockfish or mixed training for target Elo',0);return}if(mode==='target'&&estimatedElo>=trainingTargetElo){training=false;toast('target Elo already reached');return}if((source==='stockfish'||source==='mix')&&!stockfishReady){training=false;toast('load Stockfish first');setStatus('error','Stockfish is required for this training mode',0);return}trainingStartedAt=performance.now();let completed=0,trained=0;try{while((mode==='target'?estimatedElo<trainingTargetElo:completed<requested)&&!cancelRequested){const gamesThisBatch=Math.min(batch,Math.max(1,requested-completed));if(source==='self'){const r=await runParallelSelfPlay(gamesThisBatch,maxPlies);if(!r)throw new Error('parallel self-play workers unavailable');appendSamples(r.samples);trained+=r.samples.length;completed+=r.games}else{const ratio=Math.max(10,Math.min(90,Number(document.getElementById('mixRatio')?.value)||50));const engineCount=source==='mix'?Math.max(1,Math.round(gamesThisBatch*ratio/100)):gamesThisBatch;const selfCount=source==='mix'?Math.max(0,gamesThisBatch-engineCount):0;if(selfCount){const r=await runParallelSelfPlay(selfCount,maxPlies);if(r){appendSamples(r.samples);trained+=r.samples.length;completed+=r.games}}for(let g=0;g<engineCount&&!cancelRequested;g++){const r=await trainAgainstEngineGame(Math.min(maxPlies,140),5);appendSamples(r.samples);trained+=r.samples.length;completed++;setStatus('training',source==='mix'?'mixed self-play + Stockfish · '+completed+' games':'Stockfish curriculum · '+completed+' games',20)}}trainReplay(Math.min(updates,replay.length),lr);generation++;games++;steps+=Math.max(1,Math.round(trained*.02));trainingSpeed=completed/Math.max(.001,(performance.now()-trainingStartedAt)/60000);renderStats();renderTrainingLive();if(!cancelRequested){if(stockfishReady){await evaluateGenerationAgainstStockfish(Math.max(4,Math.min(20,Number(document.getElementById('evalMatches')?.value)||8)),5)}else{log('generation '+generation+' trained · Stockfish benchmark skipped because the local engine is not ready');setStatus('ready','generation '+generation+' trained · load Stockfish to benchmark',100)}await saveBrain(false)}if(mode==='target'&&source!=='self'&&completed%8===0){const e=await calibrateTrainingElo();if(e!==null)estimatedElo=e}await new Promise(r=>setTimeout(r,0))}if(!cancelRequested&&completed){await saveBrain(false);toast('training complete');log('training complete · '+source+' · '+completed+' games · '+trained+' learner positions')}else if(cancelRequested)log('training cancelled after '+completed+' games')}catch(e){log('training error: '+e.message);setStatus('error','training failed · '+e.message,0);toast('training failed')}finally{fastBatchAbort=null;if(typeof stopFastWorkers==='function')stopFastWorkers();training=false;busy=false;renderStats();if(!isGameOver(game))setStatus(cancelRequested?'paused':'ready',cancelRequested?'training stopped':'generation '+generation+' · '+games+' training games',100)}}
