/* Device-specific presentation */
try{document.documentElement.classList.add((window.chessLabDeviceProfile?.kind||'desktop')+'-mode')}catch(e){}
// Bootstrap in layers: the board is rendered first; persistence and Stockfish are allowed to fail independently.
brain=new TinyNet(Date.now());
resetRepetition();
try{updateMatchBadge()}catch(e){console.error(e)}
try{renderPlayers();renderAll()}catch(e){console.error('initial render failed',e);const el=document.getElementById('log');if(el)el.textContent+='initial render failed: '+e.message+'\\n';}
try{log('Chess Learning Lab '+CONFIG.version+' initialized')}catch(e){}
try{log('learner uses only chess rules from the environment; strategy starts random and is learned from experience')}catch(e){}
loadBrain().then(()=>{markBrainSaved();renderStats();renderTrainingLive()}).catch(e=>log('brain load error: '+e.message));
if(typeof window!=='undefined'){
  window.addEventListener('beforeunload',()=>{try{saveBrain(false)}catch(e){}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&!training)try{saveBrain(false)}catch(e){}});
}
if(window.chessLabBackend?.role==='controller'){
  log('remote controller mode · compute stays on the PC');
  setEngineUi('PC backend controller',true);
}else{
  try{createStockfish()}catch(e){log('Stockfish startup error: '+e.message);setEngineUi('engine unavailable',false)}
}
if(window.chessLabBackend?.role==='compute'){
  setInterval(()=>{
    try{
      window.chessLabBackend.publishStatus({
        training:!!training,
        generation:Number(generation)||0,
        game:Number(trainingLiveState?.game)||0,
        totalGames:Number(trainingLiveState?.totalGames)||0,
        positions:Number(trainingLiveState?.positions)||Number(replay?.length)||0,
        gamesPerMinute:Number(trainingSpeed)||0,
        phase:String(trainingLiveState?.phase||'idle')
      });
    }catch(e){}
  },1000);
}
