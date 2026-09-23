/* Reinforcement learning · self-play replay + gradient updates */
function addReplay(c,policy,value,legal){if(replay.length>=CONFIG.replayMax)replay.shift();replay.push({x:Array.from(encode(c)),policy,legal,value})}

function trainReplay(n=CONFIG.rlBatch,lr=CONFIG.lr){
  if(!brain||!replay.length)return 0;
  let total=0,used=0;
  for(let i=0;i<n;i++){
    const s=replay[(Math.random()*replay.length)|0];
    if(!s||!Array.isArray(s.legal)||!s.legal.length||!Number.isInteger(s.action))continue;
    total+=brain.trainRL(Float32Array.from(s.x),s.action,s.reward,s.legal,lr);
    used++;
  }
  if(used)steps+=used;
  return used?total/used:0;
}

async function selfPlayGame(sims=1){let c=new Chess(),samples=[],moveNo=0;const hist=new Map([[positionKey(c),1]]);while(!terminalPosition(c,hist)&&moveNo<1000&&!cancelRequested){const legal=c.moves({verbose:true});if(!legal.length)break;const side=c.turn(),x=Array.from(encode(c)),sr=await mcts(c,sims,brain,true);const safe=safeRepetitionMove(c,sr&&sr.move,brain,hist);if(safe.forcedDraw)break;const move=safe.move;if(!move)break;samples.push({x,policy:sr&&sr.policy?sr.policy:[],legal:legal.map(actionIndex),turn:side});if(!c.move({from:move.from,to:move.to,promotion:move.promotion}))break;moveNo++;const k=positionKey(c),n=(hist.get(k)||0)+1;hist.set(k,n)}let r=terminalValue(c);if(r===null)r=0;for(const s of samples)s.value=s.turn==='w'?r:-r;return {samples,moves:moveNo,result:r}}

function mutateBrain(base,rate=.02,strength=.08,seed=Date.now()){
  if(!base)throw new Error('no base learner to mutate');
  const rng=new RNG(seed>>>0);
  const out=new TinyNet(seed>>>0);
  const arrays=['w1','b1','w2','b2','wp','bp','wv'];
  for(const key of arrays){
    out[key].set(base[key]);
    const a=out[key];
    for(let i=0;i<a.length;i++){
      if(rng.next()<rate)a[i]+=rng.gauss()*strength;
    }
  }
  out.bv=base.bv+(rng.next()<rate?rng.gauss()*strength:0);
  return out;
}

function stopFastWorkers(){for(const w of fastWorkers){try{w.terminate()}catch(e){}}fastWorkers=[]}

async function evaluateMutations(candidates,best,sims,matches){
  const results=[];
  const safeMatches=Math.max(1,Math.min(8,Number(matches)||2));
  const safeSims=Math.max(1,Math.min(16,Number(sims)||4));
  for(let index=0;index<candidates.length;index++){
    if(cancelRequested)break;
    const candidate=candidates[index];
    const gamesForCandidate=[];
    let candidateScore=0;
    for(let matchIndex=0;matchIndex<safeMatches;matchIndex++){
      if(cancelRequested)break;
      const candidateWhite=(matchIndex%2===0);
      const whiteBrain=candidateWhite?candidate:best;
      const blackBrain=candidateWhite?best:candidate;
      let c=new Chess();
      let hist=new Map([[positionKey(c),1]]);
      let plies=0, repetitionHits=0, candidatePoints=0;
      while(plies<300&&!cancelRequested){
        if(isCheckmate(c)||isStalemate(c)||isInsufficientMaterial(c))break;
        const f=c.fen().split(' ');
        if(Number(f[4])>=100)break;
        const side=c.turn();
        const sideBrain=side==='w'?whiteBrain:blackBrain;
        const before=c.fen();
        let move=await learnerMove(c,safeSims,sideBrain,hist);
        if(!move)break;
        const repeated=moveCreatesRepetitionBreak(c,move,hist);
        if(repeated){
          repetitionHits++;
          candidatePoints-=2;
          const safe=safeRepetitionMove(c,move,sideBrain,hist);
          if(safe.forcedDraw){
            candidatePoints-=3;
            break;
          }
          move=safe.move;
          if(!move)break;
        }
        const mv=c.move({from:move.from,to:move.to,promotion:move.promotion});
        if(!mv)break;
        plies++;
        const k=positionKey(c);
        hist.set(k,(hist.get(k)||0)+1);
        if((plies&7)===0)await new Promise(r=>setTimeout(r,0));
      }
      const raw=terminalValue(c);
      let result=raw===null?0:raw;
      const candidateResult=candidateWhite?result:-result;
      if(raw!==null){
        if(candidateResult>0)candidatePoints+=20;
        else if(candidateResult<0)candidatePoints-=20;
      }
      candidateScore+=candidateResult*100+candidatePoints*0.25;
      gamesForCandidate.push({
        result:candidateResult,
        moves:plies,
        pointsWhite:candidateWhite?candidatePoints:0,
        pointsBlack:candidateWhite?0:candidatePoints,
        repetitionDetections:repetitionHits,
      });
    }
    results.push({index,score:candidateScore/Math.max(1,gamesForCandidate.length),results:gamesForCandidate,brain:candidate});
    setStatus('training','evaluated mutation '+(index+1)+' / '+candidates.length+' · '+gamesForCandidate.length+' matches',Math.min(95,10+85*((index+1)/candidates.length)));
    log('mutation '+index+' evaluated · score '+(candidateScore/Math.max(1,gamesForCandidate.length)).toFixed(2)+' · '+gamesForCandidate.length+' matches');
    await new Promise(r=>setTimeout(r,0));
  }
  return results;
}

async function trainBatch(){
  if(training)return;
  cancelRequested=false;training=true;busy=false;
  const requested=Math.max(1,Math.min(1000,Number(document.getElementById('batchGames').value)||16));
  const batch=Math.max(8,Math.min(256,Number(document.getElementById('parallelGames').value)||64));
  const lr=Math.max(.0001,Math.min(.01,Number(document.getElementById('mutationRate').value)||CONFIG.lr));
  const updates=Math.max(1,Math.min(256,Number(document.getElementById('evalMatches').value)||CONFIG.rlBatch));
  const maxPlies=Math.max(40,Math.min(500,Number(document.getElementById('trainSims').value)||CONFIG.trainPlies));
  let completed=0,trained=0;
  setStatus('training','neural reinforcement learning · generation '+generation+' · lr '+lr.toFixed(4),5);
  try{
    while(completed<requested&&!cancelRequested){
      const gamesThisBatch=Math.min(batch,requested-completed);
      for(let g=0;g<gamesThisBatch&&!cancelRequested;g++){
        let c=new Chess(),hist=new Map([[positionKey(c),1]]),samples=[],plies=0;
        while(!terminalPosition(c,hist)&&plies<maxPlies&&!cancelRequested){
          const legal=c.moves({verbose:true});if(!legal.length)break;
          const x=Array.from(encode(c));
          const pred=brain.predict(encode(c),legal.map(actionIndex));
          let r=Math.random(),chosen=legal[0];
          for(const m of legal){r-=pred.policy[actionIndex(m)];if(r<=0){chosen=m;break}}
          samples.push({x,action:actionIndex(chosen),legal:legal.map(actionIndex)});
          if(!c.move({from:chosen.from,to:chosen.to,promotion:chosen.promotion}))break;
          plies++;const k=positionKey(c);hist.set(k,(hist.get(k)||0)+1);
          if((plies&15)===0)await new Promise(r=>setTimeout(r,0));
        }
        let reward=terminalValue(c);if(reward===null)reward=0;
        for(let si=0;si<samples.length;si++){const s=samples[si];const sideReward=si%2===0?reward:-reward;replay.push({...s,reward:sideReward});}
        if(replay.length>CONFIG.replayMax)replay.splice(0,replay.length-CONFIG.replayMax);
        const loss=trainReplay(Math.min(updates,replay.length),lr);
        trained+=samples.length;completed++;
        if((completed&3)===0||completed===requested){generation++;setStatus('training','generation '+generation+' · RL games '+completed+' / '+requested+' · loss '+loss.toFixed(4),Math.min(96,5+91*(completed/requested)));}
        if((completed&7)===0){steps+=samples.length;games++;await saveBrain(false);renderStats();}
      }
    }
    if(!cancelRequested&&completed){await saveBrain(false);toast('neural training complete');log('neural training complete · '+completed+' games · '+trained+' positions · gradient updates');}
    else if(cancelRequested)log('neural training cancelled after '+completed+' games');
  }catch(e){log('training error: '+e.message);setStatus('error','training failed · '+e.message,0);toast('training failed')}
  finally{fastBatchAbort=null;stopFastWorkers();training=false;busy=false;renderStats();if(!isGameOver(game))setStatus(cancelRequested?'paused':'ready',cancelRequested?'training stopped':'generation '+generation+' · '+games+' training games',100)}
}