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
    const target=s.policy?.length?s.policy:[{a:s.action,p:1}];
    const loss=brain.trainPolicyValue(x,target,s.reward,s.legal,lr);
    const newValue=brain.predictLegal(x,s.legal).value;
    s.tdError=Math.abs((Number(s.reward)||0)-newValue);
    s.priority=Math.min(8,Math.max(0.05,loss+Math.abs(oldValue-newValue)));
    total+=loss;used++;
  }
  if(used)steps+=used;
  window.lastTrainingLoss=used?total/used:0;
  return used?total/used:0;
}
async function trainingPolicyMove(c,hist,state,sims=4){const legal=safeRepetitionMoves(c,hist);if(!legal.length)return null;const result=await learnerMove(c,sims,brain,hist,true);if(!result?.move)return null;return result}
async function trainAgainstEngineGame(maxPlies=120,depth=5){if(!stockfishReady)throw new Error('Stockfish is not ready. Load Stockfish first.');const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false},samples=[],learnerWhite=Math.random()<.5;trainingLiveState.fen=c.fen();renderTrainingLive();let plies=0;while(!terminalPosition(c)&&!state.forcedDraw&&plies<maxPlies&&!cancelRequested){const learnerTurn=(c.turn()==='w')===learnerWhite;let choice=learnerTurn?await trainingPolicyMove(c,hist,state,Math.max(1,Math.min(16,Number(document.getElementById('sims')?.value)||4))):null;let move=learnerTurn?choice?.move:await stockfishMove(c,depth,safeRepetitionMoves(c,hist));if(!move)break;if(learnerTurn)samples.push({x:Array.from(encode(c)),action:actionIndex(move),policy:choice?.policy||[{a:actionIndex(move),p:1}],legal:safeRepetitionMoves(c,hist).map(actionIndex),side:c.turn()});if(moveCreatesRepetitionBreak(c,move,hist)){const safe=safeRepetitionMove(c,move,brain,hist,state);if(safe.forcedDraw)break;move=safe.move}if(!c.move({from:move.from,to:move.to,promotion:move.promotion}))break;plies++;trainingLiveState.fen=c.fen();recordPosition(c,hist);if((plies&15)===0)await new Promise(r=>setTimeout(r,0))}let result=terminalValue(c);if(result===null)result=0;const learnerResult=learnerWhite?result:-result;for(const s of samples)s.reward=learnerResult;return {samples,result:learnerResult,moves:plies,source:'stockfish'}}
function invalidateTrainingSearch(){if(typeof resetMctsTree==='function')resetMctsTree()}

function appendSamples(samples){
  if(!Array.isArray(samples)||!samples.length)return;
  for(const s of samples)if(s&&Array.isArray(s.legal)&&s.legal.length){s.x=s.x instanceof Float32Array?s.x:Float32Array.from(s.x||[]);s.priority=Number.isFinite(s.priority)?s.priority:1;s.age=0;replay.push(s);}for(const s of replay)if(s)s.age=(Number(s.age)||0)+1;
  if(replay.length>CONFIG.replayMax)replay.splice(0,replay.length-CONFIG.replayMax);
}
let browserTrainingPaused=false;
async function trainingUiYield(){
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  while(browserTrainingPaused&&!cancelRequested) await new Promise(resolve=>setTimeout(resolve,100));
}
function pauseBrowserTraining(){if(training){browserTrainingPaused=true;trainingLiveState.phase='paused';trainingLiveState.detail='training paused';renderTrainingLive();setStatus('paused','browser training paused',0)}}
function resumeBrowserTraining(){if(training){browserTrainingPaused=false;trainingLiveState.phase='training';trainingLiveState.detail='resuming training';renderTrainingLive();setStatus('training','browser training resumed',0)}}

async function browserSelfPlayGame(maxPlies=120){
  const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false},samples=[];
  trainingLiveState.fen=c.fen();renderTrainingLive();
  let plies=0;
  while(!terminalPosition(c)&&!state.forcedDraw&&plies<maxPlies&&!cancelRequested){
    const legal=safeRepetitionMoves(c,hist);
    if(!legal.length)break;
    const choice=await learnerMove(c,Math.max(1,Math.min(16,Number(document.getElementById('sims')?.value)||4)),brain,hist,true);
    if(!choice?.move)break;
    const proposed=choice.move;
    const move=safeRepetitionMove(c,proposed,brain,hist,state);
    if(move.forcedDraw||!move.move)break;
    const chosen=move.move;
    samples.push({x:Array.from(encode(c)),action:actionIndex(chosen),policy:choice.policy?.length?choice.policy:[{a:actionIndex(chosen),p:1}],legal:legal.map(actionIndex),side:c.turn()});
    if(!c.move({from:chosen.from,to:chosen.to,promotion:chosen.promotion}))break;
    plies++;
    trainingLiveState.fen=c.fen();
    recordPosition(c,hist);
    if((plies&1)===0)await trainingUiYield();
  }
  trainingLiveState.ply=plies;renderTrainingLive();
  let r=terminalValue(c);if(r===null)r=0;
  for(const s of samples)s.reward=s.side==='w'?r:-r;
  return {samples,games:1,moves:plies};
}
async function runParallelSelfPlay(gameCount,maxPlies){
  const requested=Math.max(1,Number(gameCount)||1);
  trainingLiveState.totalGames=requested;trainingLiveState.game=0;
  const profile=window.chessLabDeviceProfile||{kind:/Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'')?'mobile':'desktop',cores:navigator.hardwareConcurrency||2,memoryGB:Number(navigator.deviceMemory)||2,webgpu:false};
  const mobile=profile.kind==='mobile';
  const cores=Math.max(1,profile.cores||2);
  const memoryGB=Number(navigator.deviceMemory)||2;
  const highEndAndroid=mobile&&cores>=8&&memoryGB>=8;
  const workerCap=mobile ? (highEndAndroid?3:Math.max(1,Math.min(2,Math.floor(memoryGB/1.5)||1))) : Math.max(1,cores-1);
  const workers=Math.max(1,Math.min(requested,workerCap));
  trainingLiveState.workers=workers;trainingLiveState.sims=Math.max(1,Math.min(64,Number(document.getElementById('sims')?.value)||4));
  // On Android, keep the main thread responsive and avoid a worker startup deadlock.
  // The Fold 6 has plenty of CPU, but browser workers can still stall on large model
  // structured clones. Direct browser self-play is more reliable for this model size.
  if(mobile){
    trainingLiveState.workers=1;
    const all=[];
    for(let g=0;g<requested&&!cancelRequested;g++){
      const r=await browserSelfPlayGame(maxPlies);
      all.push(...r.samples);
      setStatus('training','mobile browser self-play · '+(g+1)+' / '+requested+' games',Math.round((g+1)/requested*100));
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
          const w=new Worker('js/training-worker.js?v=0.31.20');
          fastWorkers.push(w);
          let finished=false;
          const cleanup=()=>{try{w.terminate()}catch(e){}};
          w.onmessage=e=>{
            const d=e.data||{};
            if(d.type==='batch'&&!finished){
              finished=true;done++;all.push(...(d.samples||[]));cleanup();
              if(done===expected)resolve({samples:all,games:requested,workers});
            }else if(d.type==='progress'&&!finished){trainingLiveState.game=(i*per)+Number(d.game||0);trainingLiveState.totalGames=requested;trainingLiveState.ply=Number(d.plies||0);trainingLiveState.detail='self-play · game '+trainingLiveState.game+' / '+requested+' · '+Number(d.positions||0)+' positions';setStatus('training',trainingLiveState.detail,Math.round(trainingLiveState.game/requested*100));renderTrainingLive();}else if(d.type==='error'&&!finished){
              finished=true;cleanup();reject(new Error(d.message||'training worker failed'));
            }
          };
          w.onerror=e=>{if(!finished){finished=true;cleanup();reject(new Error(e.message||'training worker crashed'))}};
          w.postMessage({type:'train',brain:payload,games:gamesForWorker,maxPlies,sims:trainingLiveState.sims});
        }
      });
    }catch(e){
      log('worker self-play unavailable · using browser fallback: '+e.message);
      stopFastWorkers();
    }
  }
  const all=[];for(let g=0;g<requested&&!cancelRequested;g++){
    trainingLiveState.game=g+1;trainingLiveState.totalGames=requested;
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
  const previousElo=Number.isFinite(estimatedElo)?estimatedElo:400;
  const boundedScore=Math.max(.02,Math.min(.98,score));
  estimatedElo=Math.round(Math.max(400,Math.min(3000,3000+400*Math.log10(boundedScore/(1-boundedScore)))));
  evalRecord={generation,engine:'Stockfish 19',strength:'full',games:total,wins,draws,losses,score,elo:estimatedElo,eloChange:estimatedElo-previousElo};
  evaluationHistory=(evaluationHistory||[]).concat([evalRecord]).slice(-100);
  if(score>bestEvalScore){bestEvalScore=score;championGeneration=generation;log('generation '+generation+' became champion · Stockfish score '+Math.round(score*100)+'%');if(typeof saveChampionSnapshot==='function')await saveChampionSnapshot()}
  estimatedElo=estimatedElo||400;
  log('generation '+generation+' · Stockfish '+wins+'W '+draws+'D '+losses+'L · score '+Math.round(score*100)+'%');
  return evalRecord;
}
async function calibrateTrainingElo(){if(!stockfishReady||cancelRequested)return null;const anchors=[1320,1500,1800],scores=[];for(const anchor of anchors){if(cancelRequested)break;try{stockfishWorker.postMessage('setoption name UCI_LimitStrength value true');stockfishWorker.postMessage('setoption name UCI_Elo value '+anchor);stockfishWorker.postMessage('isready')}catch(e){}const r=await trainAgainstEngineGame(70,4);scores.push(r.result>0?1:r.result<0?0:.5)}try{stockfishWorker.postMessage('setoption name UCI_LimitStrength value false');stockfishWorker.postMessage('isready')}catch(e){}if(!scores.length)return null;return Math.round(1320+(scores.reduce((a,b)=>a+b,0)/scores.length)*480)}
async function nativeTrainBatch(){
  if(!window.chessLabBackend?.nativeCompute?.()) return false;
  const api=window.chessLabBackend.getUrl();
  const num=id=>Number(document.getElementById(id)?.value)||0;
  const payload={
    games:Math.max(1,Math.min(64,num('batchGames')||4)),
    generations:(document.getElementById('trainingMode')?.value==='continuous')?1000000:1,
    maxPlies:Math.max(20,Math.min(2000,num('trainSims')||200)),
    simulations:Math.max(1,Math.min(512,num('learnerSims')||32)),
    updates:Math.max(1,Math.min(100000,num('trainUpdates')||32)),
    batch:Math.max(1,Math.min(1024,num('trainBatchSize')||32)),
    replay:Math.max(1000,Math.min(500000,num('replaySize')||100000)),
    evalGames:Math.max(2,Math.min(100,num('evalGames')||4)),
    evalPlies:Math.max(20,Math.min(2000,num('evalPlies')||200)),
    stockfishDepth:Math.max(1,Math.min(30,num('stockfishDepth')||10)),
    stockfishThreads:Math.max(1,Math.min(64,num('stockfishThreads')||1))
  };
  if(document.getElementById('trainingMode')?.value==='target'){
    payload.generations=Math.max(1,Math.min(1000000,1000));
  }
  training=true;cancelRequested=false;trainingStartedAt=performance.now();
  setStatus('training','starting Rust training backend…',0);
  const ok=await window.chessLabBackend.command('start-training',payload);
  if(!ok){training=false;setStatus('error','Rust training backend could not start',0);return true;}
  log('Rust training started · Stockfish 19 generation evaluation enabled');
  let lastGeneration=Number(generation)||0;
  try{
    while(!cancelRequested){
      const r=await fetch(api+'/api/training/status',{cache:'no-store'});
      if(!r.ok)throw new Error('training status HTTP '+r.status);
      const s=await r.json();
      generation=Number(s.generation)||0;games=Number(s.games)||0;steps=Number(s.optimizer_step)||0;
      if(typeof replay!=='undefined'&&Array.isArray(replay)){}
      const liveGames=document.getElementById('liveGames');if(liveGames)liveGames.textContent=String(s.games||0);
      const livePositions=document.getElementById('livePositions');if(livePositions)livePositions.textContent=String(s.positions||0);
      const liveLoss=document.getElementById('liveLoss');if(liveLoss)liveLoss.textContent=Number.isFinite(s.loss)?Number(s.loss).toFixed(4):'—';
      const liveUpdates=document.getElementById('liveUpdates');if(liveUpdates)liveUpdates.textContent=String(s.optimizer_step||0);
      const livePhase=document.getElementById('livePhase');if(livePhase)livePhase.textContent=String(s.phase||'training').toUpperCase();
      const liveDetail=document.getElementById('liveDetail');if(liveDetail)liveDetail.textContent=(s.last_error||('Rust backend · '+String(s.phase||'training')));
      const genText=document.getElementById('trainingGenerationText');if(genText)genText.textContent='GEN '+generation;
      const badge=document.getElementById('generationBadge');if(badge)badge.textContent='GEN '+generation;
      const evalBadge=document.getElementById('evaluationBadge');if(evalBadge)evalBadge.textContent=s.evaluation_games?('SF '+Math.round(Number(s.evaluation_score||0)*100)+'%'):'NOT EVALUATED';
      const genScore=document.getElementById('generationScore');if(genScore)genScore.textContent=s.evaluation_games?Math.round(Number(s.evaluation_score||0)*100)+'%':'—';
      const genGames=document.getElementById('generationGames');if(genGames)genGames.textContent=String(s.games||0);
      const genPos=document.getElementById('generationPositions');if(genPos)genPos.textContent=String(s.positions||0);
      const genLoss=document.getElementById('generationLoss');if(genLoss)genLoss.textContent=Number.isFinite(s.loss)?Number(s.loss).toFixed(4):'—';
      const line=document.getElementById('evaluationLine');if(line)line.textContent=s.evaluation_games?('Stockfish 19: '+s.evaluation_wins+'W '+s.evaluation_draws+'D '+s.evaluation_losses+'L · score '+Math.round(s.evaluation_score*100)+'%'+(s.champion_generation===generation?' · CHAMPION PROMOTED':'')):(s.last_error||'Generation is running.');
      const perf=document.getElementById('performanceBadge');if(perf)perf.textContent=s.running?'RUNNING':'LAST RUN';
      setStatus(s.running?(s.phase==='evaluating'?'evaluating':'training'):'ready',s.last_error||('Rust · '+String(s.phase||'idle')),s.running?50:100);
      if(generation!==lastGeneration){
        lastGeneration=generation;
        log('generation '+generation+' · '+s.games+' games · '+s.positions+' positions · loss '+Number(s.loss||0).toFixed(4));
        if(s.evaluation_games)log('Stockfish 19 · '+s.evaluation_wins+'W '+s.evaluation_draws+'D '+s.evaluation_losses+'L · '+Math.round(s.evaluation_score*100)+'% · champion gen '+s.champion_generation);
      }
      if(!s.running)break;
      await new Promise(r=>setTimeout(r,750));
    }
  }catch(e){log('Rust training status error: '+e.message);setStatus('error',e.message,0)}
  finally{
    training=false;busy=false;
    window.chessLabPerformance={durationMs:performance.now()-trainingStartedAt,games:Number(games)||0,positions:Number(document.getElementById('livePositions')?.textContent)||0};
    const d=document.getElementById('perfDuration');if(d)d.textContent=(window.chessLabPerformance.durationMs/1000).toFixed(1)+'s';
    const p=document.getElementById('perfPositions');if(p)p.textContent=String(window.chessLabPerformance.positions);
    const t=document.getElementById('perfTraining');if(t)t.textContent='Rust native';
    const sf=document.getElementById('perfStockfish');if(sf)sf.textContent='Stockfish 19';
    renderStats?.();renderTrainingLive?.();
  }
  return true;
}
async function trainBatch(){
  if(window.chessLabBackend?.nativeCompute?.()){await nativeTrainBatch();return;}
  toast('Rust backend is required for native training');
  setStatus('error','open Chess Lab from the local Rust backend',0);
}
