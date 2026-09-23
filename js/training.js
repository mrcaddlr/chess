/* Reinforcement learning · parallel self-play + engine curriculum */
function replayPriority(s){
  const base=Math.max(0.05,Number(s.priority)||0.05);
  const surprise=Math.min(4,Math.abs(Number(s.reward)||0)+Math.abs(Number(s.tdError)||0));
  const age=Math.max(0,Number(s.age)||0);
  return base+surprise*0.75+1/Math.sqrt(age+1);
}
function trainReplay(n=CONFIG.rlBatch,lr=CONFIG.lr){
  if(!brain||!replay.length)return 0;
  let total=0,used=0;
  const len=replay.length,recentStart=Math.max(0,len-Math.min(5000,len));
  for(let i=0;i<n;i++){
    let s=null;
    // 70% prioritized, 20% recent, 10% uniform.
    const mode=i%10;
    if(mode<7){
      // Approximate prioritized sampling with a small weighted candidate pool.
      // This avoids an O(replaySize) scan for every gradient update on phones.
      const candidates=[];let sum=0;
      for(let j=0;j<24;j++){const candidate=replay[(Math.random()*len)|0];if(candidate){const w=replayPriority(candidate);candidates.push([candidate,w]);sum+=w}}
      let r=Math.random()*Math.max(sum,.0001);for(const pair of candidates){r-=pair[1];if(r<=0){s=pair[0];break}}
      if(!s&&candidates.length)s=candidates[0][0];
    }else if(mode<9){
      s=replay[recentStart+((Math.random()*Math.max(1,len-recentStart))|0)];
    }else s=replay[(Math.random()*len)|0];
    if(!s||!Array.isArray(s.legal)||!s.legal.length)continue;
    const x=s.x instanceof Float32Array?s.x:Float32Array.from(s.x);
    const oldValue=brain.predictLegal(x,s.legal).value;
    const loss=s.policy?.length?brain.trainPolicyValue(x,s.policy,s.reward,s.legal,lr):brain.trainRL(x,s.action,s.reward,s.legal,lr);
    const newValue=brain.predictLegal(x,s.legal).value;
    s.tdError=Math.abs((Number(s.reward)||0)-newValue);
    s.priority=Math.min(8,Math.max(0.05,loss+Math.abs(oldValue-newValue)));
    total+=loss;used++;
  }
  if(used)steps+=used;
  window.lastTrainingLoss=used?total/used:0;
  return used?total/used:0;
}
function trainingPolicyMove(c,hist,state){const legal=safeRepetitionMoves(c,hist);if(!legal.length)return null;const proposed=softmaxLegal(c,.9,brain),safe=safeRepetitionMove(c,proposed,brain,hist,state);return safe.forcedDraw?null:safe.move}
async function trainAgainstEngineGame(maxPlies=120,depth=5){if(!stockfishReady)throw new Error('Stockfish is not ready. Load Stockfish first.');const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false},samples=[],learnerWhite=Math.random()<.5;let plies=0;while(!terminalPosition(c)&&!state.forcedDraw&&plies<maxPlies&&!cancelRequested){const learnerTurn=(c.turn()==='w')===learnerWhite;let move=learnerTurn?trainingPolicyMove(c,hist,state):await stockfishMove(c,depth,safeRepetitionMoves(c,hist));if(!move)break;if(learnerTurn)samples.push({x:Array.from(encode(c)),action:actionIndex(move),legal:safeRepetitionMoves(c,hist).map(actionIndex)});if(moveCreatesRepetitionBreak(c,move,hist)){const safe=safeRepetitionMove(c,move,brain,hist,state);if(safe.forcedDraw)break;move=safe.move}if(!c.move({from:move.from,to:move.to,promotion:move.promotion}))break;plies++;recordPosition(c,hist);if((plies&15)===0)await new Promise(r=>setTimeout(r,0))}let result=terminalValue(c);if(result===null)result=0;const learnerResult=learnerWhite?result:-result;for(const s of samples)s.reward=learnerResult;return {samples,result:learnerResult,moves:plies,source:'stockfish'}}
function appendSamples(samples){
  if(!Array.isArray(samples)||!samples.length)return;
  for(const s of samples)if(s&&Array.isArray(s.legal)&&s.legal.length){s.x=s.x instanceof Float32Array?s.x:Float32Array.from(s.x||[]);s.priority=Number.isFinite(s.priority)?s.priority:1;s.age=0;replay.push(s);}for(const s of replay)if(s)s.age=(Number(s.age)||0)+1;
  if(replay.length>CONFIG.replayMax)replay.splice(0,replay.length-CONFIG.replayMax);
}
function trainingUiYield(){return new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)))}

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
  trainingLiveState.totalGames=requested;trainingLiveState.game=0;
  const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'');
  const cores=Math.max(1,navigator.hardwareConcurrency||2);
  const memoryGB=Number(navigator.deviceMemory)||2;
  const highEndAndroid=mobile&&cores>=8&&memoryGB>=8;
  const workerCap=mobile
    ? (highEndAndroid?3:Math.max(1,Math.min(2,Math.floor(memoryGB/1.5)||1)))
    : Math.max(1,cores-1);
  const workers=Math.max(1,Math.min(requested,workerCap));
  // On Android, keep the main thread responsive and avoid a worker startup deadlock.
  // The Fold 6 has plenty of CPU, but browser workers can still stall on large model
  // structured clones. Direct browser self-play is more reliable for this model size.
  if(mobile){
    const all=[];
    for(let g=0;g<requested&&!cancelRequested;g++){
      const r=await browserSelfPlayGame(maxPlies);
      all.push(...r.samples);
      setStatus('training','Fold 6 browser self-play · '+(g+1)+' / '+requested+' games',Math.round((g+1)/requested*100));
      renderTrainingLive();
      await trainingUiYield();
    }
    return {samples:all,games:requested,workers:1};
  }
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
          const w=new Worker('js/training-worker.js?v=0.15.0');
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
async function evaluateGenerationAgainstStockfish(games=10,depth=5){
  if(!stockfishReady||!stockfishWorker)return null;
  stockfishSetStrength(true);
  let wins=0,draws=0,losses=0;
  for(let i=0;i<games&&!cancelRequested;i++){
    const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false};
    const learnerWhite=i%2===0;let plies=0;
    while(!terminalPosition(c)&&!state.forcedDraw&&plies<120&&!cancelRequested){
      const learnerTurn=(c.turn()==='w')===learnerWhite,legal=safeRepetitionMoves(c,hist);
      if(!legal.length)break;
      let move=learnerTurn?await learnerMove(c,Math.max(1,Math.min(16,Number(document.getElementById('sims')?.value)||4)),brain,hist):await stockfishMove(c,depth,legal);
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
  evalRecord={generation,engine:'Stockfish 19',strength:'full',games:total,wins,draws,losses,score,elo:null,eloChange:null};
  evaluationHistory=(evaluationHistory||[]).concat([evalRecord]).slice(-100);
  if(score>bestEvalScore){bestEvalScore=score;championGeneration=generation;log('generation '+generation+' became champion · Stockfish score '+Math.round(score*100)+'%')}
  estimatedElo=estimatedElo||400;
  log('generation '+generation+' · Stockfish '+wins+'W '+draws+'D '+losses+'L · score '+Math.round(score*100)+'%');
  return evalRecord;
}
async function calibrateTrainingElo(){if(!stockfishReady||cancelRequested)return null;const anchors=[1320,1500,1800],scores=[];for(const anchor of anchors){if(cancelRequested)break;try{stockfishWorker.postMessage('setoption name UCI_LimitStrength value true');stockfishWorker.postMessage('setoption name UCI_Elo value '+anchor);stockfishWorker.postMessage('isready')}catch(e){}const r=await trainAgainstEngineGame(70,4);scores.push(r.result>0?1:r.result<0?0:.5)}try{stockfishWorker.postMessage('setoption name UCI_LimitStrength value false');stockfishWorker.postMessage('isready')}catch(e){}if(!scores.length)return null;return Math.round(1320+(scores.reduce((a,b)=>a+b,0)/scores.length)*480)}
async function trainBatch(){if(training)return;cancelRequested=false;training=true;busy=false;const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'');const requested=Math.max(1,Math.min(1000,Number(document.getElementById('batchGames').value)||8)),batch=Math.max(1,Math.min(mobile?4:256,Number(document.getElementById('parallelGames').value)||(mobile?4:64))),lr=Math.max(.0001,Math.min(.01,Number(document.getElementById('mutationRate').value)||CONFIG.lr)),updatesPerGame=Math.max(1,Math.min(mobile?16:512,Number(document.getElementById('trainUpdates')?.value)||(mobile?8:CONFIG.rlBatch))),maxPlies=Math.max(40,Math.min(1000,Number(document.getElementById('trainSims').value)||CONFIG.trainPlies)),mode=document.getElementById('trainingMode')?.value||'games',source=document.getElementById('trainOpponent')?.value||'self';trainingTargetElo=Math.max(400,Math.min(2400,Number(document.getElementById('targetElo')?.value)||1000));if(mode==='target'&&source==='self'){training=false;toast('target Elo mode needs an engine benchmark');setStatus('ready','choose Stockfish or mixed training for target Elo',0);return}if(mode==='target'&&estimatedElo>=trainingTargetElo){training=false;toast('target Elo already reached');return}if((source==='stockfish'||source==='mix')&&!stockfishReady){training=false;toast('load Stockfish first');setStatus('error','Stockfish is required for this training mode',0);return}trainingStartedAt=performance.now();let completed=0,trained=0;try{setStatus('training','starting browser training…',0);renderTrainingLive();log('training started · '+source+' · '+(mobile?'Android browser mode':'parallel browser workers'));while((mode==='target'?estimatedElo<trainingTargetElo:completed<requested)&&!cancelRequested){const gamesThisBatch=Math.min(batch,Math.max(1,requested-completed));if(source==='self'){const r=await runParallelSelfPlay(gamesThisBatch,maxPlies);if(!r)throw new Error('parallel self-play workers unavailable');appendSamples(r.samples);trained+=r.samples.length;completed+=r.games}else{const ratio=Math.max(10,Math.min(90,Number(document.getElementById('mixRatio')?.value)||50));const engineCount=source==='mix'?Math.max(1,Math.round(gamesThisBatch*ratio/100)):gamesThisBatch;const selfCount=source==='mix'?Math.max(0,gamesThisBatch-engineCount):0;if(selfCount){const r=await runParallelSelfPlay(selfCount,maxPlies);if(r){appendSamples(r.samples);trained+=r.samples.length;completed+=r.games}}for(let g=0;g<engineCount&&!cancelRequested;g++){const r=await trainAgainstEngineGame(Math.min(maxPlies,140),5);appendSamples(r.samples);trained+=r.samples.length;completed++;setStatus('training',source==='mix'?'mixed self-play + Stockfish · '+completed+' / '+requested+' games':'Stockfish curriculum · '+completed+' / '+requested+' games',20)}}renderTrainingLive();setStatus('training','generation '+(generation+1)+' collecting games · '+completed+' / '+requested,Math.round(completed/requested*80));await new Promise(r=>setTimeout(r,0))}if(!cancelRequested&&completed){const generationGames=completed;const updateCount=Math.max(1,Math.min(updatesPerGame*generationGames,replay.length));trainingLiveState.phase='training';trainingLiveState.detail='updating neural network · '+updateCount+' gradient updates';renderTrainingLive();setStatus('training','generation '+(generation+1)+' · training '+updateCount+' replay updates',82);const loss=trainReplay(updateCount,lr);markBrainDirty();renderStats();renderTrainingLive();await saveBrain(false);steps+=Math.max(1,updateCount);trainingSpeed=completed/Math.max(.001,(performance.now()-trainingStartedAt)/60000);renderStats();renderTrainingLive();log('generation '+(generation+1)+' trained · '+generationGames+' games · '+trained+' learner positions · loss '+(Number.isFinite(loss)?loss.toFixed(4):'—'));generation++;games+=generationGames;markBrainDirty();renderStats();renderTrainingLive();if(stockfishReady){await evaluateGenerationAgainstStockfish(Math.max(4,Math.min(50,Number(document.getElementById('evalGames')?.value)||10)),5)}else{log('generation '+generation+' trained · Stockfish benchmark skipped because the local engine is not ready');setStatus('ready','generation '+generation+' trained · load Stockfish to benchmark',100)}await saveBrain(false);toast('generation '+generation+' complete');log('generation '+generation+' complete · '+source+' · '+generationGames+' games · '+trained+' learner positions')}else if(cancelRequested){log('training cancelled after '+completed+' games')} }catch(e){log('training error: '+e.message);setStatus('error','training failed · '+e.message,0);toast('training failed')}finally{trainingLiveState.phase='idle';trainingLiveState.detail='generation complete';renderTrainingLive();fastBatchAbort=null;if(typeof stopFastWorkers==='function')stopFastWorkers();training=false;busy=false;renderStats();if(!isGameOver(game))setStatus(cancelRequested?'paused':'ready',cancelRequested?'training stopped':'generation '+generation+' · '+games+' training games',100)}}