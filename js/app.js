/* Application bootstrap + event wiring */
'use strict';
/* Theme preference */
function applyTheme(theme){document.documentElement.dataset.theme=theme;const dark=theme==='dark';const icon=document.getElementById('themeIcon');const label=document.getElementById('themeLabel');if(icon)icon.textContent=dark?'☀':'☾';if(label)label.textContent=dark?'light':'dark';const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=dark?'#171521':'#fff8fc';try{localStorage.setItem('chess-theme',theme)}catch(e){}}
let savedTheme='light';try{savedTheme=localStorage.getItem('chess-theme')||'light'}catch(e){}applyTheme(savedTheme==='dark'?'dark':'light');
document.getElementById('themeToggle').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
document.getElementById('clearLog').onclick=()=>{document.getElementById('log').textContent='';log('log cleared')};
document.getElementById('startTraining').type='button';document.getElementById('playMatch').type='button';document.getElementById('simulateMove').type='button';document.getElementById('newGame').type='button';document.getElementById('flip').type='button';document.getElementById('stopTrain').type='button';document.getElementById('startTraining').onclick=()=>{trainBatch().catch(e=>{log('training launch error: '+e.message);setStatus('error','training failed to start',0)})};document.getElementById('playMatch').onclick=()=>{playMatch().catch(e=>{busy=false;log('Play error: '+e.message);setStatus('error',e.message,0);renderAll()})};document.getElementById('simulateMove').onclick=()=>{simulateOneMove().catch(e=>{busy=false;log('1 move error: '+e.message);setStatus('error',e.message,0);renderAll()})};document.getElementById('newGame').onclick=()=>newGame();document.getElementById('flip').onclick=()=>{flipped=!flipped;renderBoard()};document.getElementById('stopTrain').onclick=()=>{cancelEngine();training=false;busy=false;setStatus('paused','stopped');renderAll();toast('stopped')};document.getElementById('matchType').onchange=()=>{const type=document.getElementById('matchType').value;document.getElementById('engineField').style.display=type==='learner-engine'?'grid':'none';updateMatchBadge();setStatus('ready','press Play to randomize sides and start the match',0)};
document.getElementById('engineSelect').onchange=async()=>{selectedEngine=document.getElementById('engineSelect').value;document.getElementById('customEngineField').style.display=selectedEngine==='custom-wasm'?'grid':'none';matchEpoch++;await createStockfish(true);updateMatchBadge();setStatus('ready',engineDisplayLabel()+' selected · press Play',0)};
document.getElementById('customEngineUrl').onchange=async()=>{if(selectedEngine==='custom-wasm'){matchEpoch++;await createStockfish(true);}};document.getElementById('saveBrain').onclick=()=>saveBrain();document.getElementById('loadBrain').onclick=loadBrain;document.getElementById('resetBrain').onclick=resetBrain;document.getElementById('exportBrain').onclick=exportBrain;document.getElementById('importBrain').onclick=importBrain;document.getElementById('promoModal').onclick=e=>{if(e.target.id==='promoModal')e.currentTarget.classList.remove('open')};

// Bootstrap in layers: the board is rendered first; persistence and Stockfish are allowed to fail independently.
brain=new TinyNet(Date.now());
resetRepetition();
try{updateMatchBadge()}catch(e){console.error(e)}
try{renderPlayers();renderAll()}catch(e){console.error('initial render failed',e);const el=document.getElementById('log');if(el)el.textContent+='initial render failed: '+e.message+'\\n';}
try{log('Chess Learning Lab '+CONFIG.version+' initialized')}catch(e){}
try{log('learner uses only chess rules from the environment; strategy starts random and is learned from experience')}catch(e){}
loadBrain().catch(e=>log('brain load error: '+e.message));
try{createStockfish()}catch(e){log('Stockfish startup error: '+e.message);setEngineUi('engine unavailable',false)}
