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
try{createStockfish()}catch(e){log('Stockfish startup error: '+e.message);setEngineUi('engine unavailable',false)}
