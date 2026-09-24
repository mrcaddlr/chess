/* Theme preferences */
(function(){
  const root=document.documentElement;
  const $=id=>document.getElementById(id);
  const uiThemes=['sakura','pink','catppuccin','ocean','mint','lavender','sunset','mono'];
  const boardThemes=['classic','catppuccin','rose','ocean','mint','lavender','mono'];
  function read(key,fallback){try{return localStorage.getItem(key)||fallback}catch(e){return fallback}}
  function write(key,value){try{localStorage.setItem(key,value)}catch(e){}}
  function applyTheme(theme){
    const t=theme==='dark'?'dark':'light';
    root.dataset.theme=t;
    root.classList.toggle('is-dark',t==='dark');
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=t==='dark'?'#1e1e2e':'#fff8fc';
    write('chess-theme',t);
  }
  function applyUiTheme(theme){
    const t=uiThemes.includes(theme)?theme:'sakura';
    root.dataset.uiTheme=t;
    write('chess-ui-theme',t);
    const s=$('uiThemeSelect');if(s)s.value=t;
    root.classList.remove('theme-pulse');void root.offsetWidth;root.classList.add('theme-pulse');
  }
  function applyBoardTheme(theme){
    const t=boardThemes.includes(theme)?theme:'classic';
    root.dataset.boardTheme=t;
    write('chess-board-theme',t);
    const s=$('boardThemeSelect');if(s)s.value=t;
  }
  function openThemes(){const m=$('themeModal');if(m)m.classList.add('open')}
  function closeThemes(){const m=$('themeModal');if(m)m.classList.remove('open')}
  const savedTheme=read('chess-theme',window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  const savedUi=read('chess-ui-theme','sakura');
  const savedBoard=read('chess-board-theme','classic');
  applyTheme(savedTheme);applyUiTheme(savedUi);applyBoardTheme(savedBoard);

  $('themeSettings')?.addEventListener('click',openThemes);
  $('closeThemeSettings')?.addEventListener('click',closeThemes);
  $('themeModal')?.addEventListener('click',e=>{if(e.target===$('themeModal'))closeThemes()});
  $('uiThemeSelect')?.addEventListener('change',e=>applyUiTheme(e.target.value));
  $('boardThemeSelect')?.addEventListener('change',e=>applyBoardTheme(e.target.value));
  $('themeLight')?.addEventListener('click',()=>applyTheme('light'));
  $('themeDark')?.addEventListener('click',()=>applyTheme('dark'));

  $('clearLog')?.addEventListener('click',()=>{$('log').textContent='';log('log cleared')});

  $('startTraining')?.addEventListener('click',()=>trainBatch().catch(e=>{log('training launch error: '+e.message);setStatus('error','training failed to start',0)}));
  $('stopTraining')?.addEventListener('click',()=>{cancelRequested=true;cancelEngine();training=false;busy=false;setStatus('paused','training stopped',0);renderStats();toast('training stopped')});
  $('playMatch')?.addEventListener('click',()=>playMatch().catch(e=>{busy=false;log('Play error: '+e.message);setStatus('error',e.message,0);renderAll()}));
  $('simulateMove')?.addEventListener('click',()=>simulateOneMove().catch(e=>{busy=false;log('1 move error: '+e.message);setStatus('error',e.message,0);renderAll()}));
  $('newGame')?.addEventListener('click',()=>newGame());
  $('flip')?.addEventListener('click',()=>{flipped=!flipped;renderBoard()});
  $('stopTrain')?.addEventListener('click',()=>{cancelEngine();training=false;busy=false;setStatus('paused','stopped');renderAll();toast('stopped')});
  $('trainingMode')?.addEventListener('change',()=>{const e=$('targetEloField');if(e)e.style.display=$('trainingMode').value==='target'?'grid':'none';renderStats()});
  $('trainOpponent')?.addEventListener('change',()=>{const e=$('mixRatioField');if(e)e.style.display=$('trainOpponent').value==='mix'?'grid':'none'});
  $('matchType')?.addEventListener('change',()=>{const type=$('matchType').value;$('engineField').style.display=type==='learner-engine'?'grid':'none';updateMatchBadge();setStatus('ready','press Play to randomize sides and start the match',0)});
  $('engineSelect')?.addEventListener('change',async()=>{selectedEngine=$('engineSelect').value;$('customEngineField').style.display=selectedEngine==='custom-wasm'?'grid':'none';matchEpoch++;setEngineUi('loading '+engineDisplayLabel(),false);await createStockfish(true);updateMatchBadge();setStatus(stockfishReady?'ready':'engine unavailable',stockfishReady?engineDisplayLabel()+' ready':'could not start '+engineDisplayLabel(),0)});
  $('customEngineUrl')?.addEventListener('change',async()=>{if(selectedEngine==='custom-wasm'){matchEpoch++;await createStockfish(true)}});
  $('saveBrain')?.addEventListener('click',()=>saveBrain());$('loadBrain')?.addEventListener('click',loadBrain);$('restoreChampion')?.addEventListener('click',()=>restoreChampionSnapshot().catch(e=>{log('champion restore error: '+e.message)}));$('resetBrain')?.addEventListener('click',resetBrain);$('exportBrain')?.addEventListener('click',exportBrain);$('importBrain')?.addEventListener('click',importBrain);
  $('promoModal')?.addEventListener('click',e=>{if(e.target.id==='promoModal')e.currentTarget.classList.remove('open')});

  const tm=$('trainingMode');if(tm){const e=$('targetEloField');if(e)e.style.display=tm.value==='target'?'grid':'none'}
  const to=$('trainOpponent');if(to){const e=$('mixRatioField');if(e)e.style.display=to.value==='mix'?'grid':'none'}
})();/* Panels, moves, review and status rendering */
function renderMoves(){const list=document.getElementById('moveList'),hist=game.history();list.innerHTML='';for(let i=0;i<hist.length;i++){const d=document.createElement('div');d.className='move';const q=moveRecords[i]?.quality||'';const pd=moveRecords[i]?.pointDelta;d.innerHTML='<b>'+((i>>1)+1)+(i%2?'...':'.')+'</b>'+hist[i]+(q?' <span style="float:right;font-weight:900">'+q+(Number.isFinite(pd)?' '+(pd>=0?'+':'')+pd:'')+'</span>':'');list.appendChild(d)}document.getElementById('moveCount').textContent=hist.length+' plies'}

function renderReview(){const b=document.getElementById('reviewBadge'),s=document.getElementById('reviewSummary'),g=document.getElementById('reviewGrid');if(!b||!s||!g)return;if(!reviewState){b.textContent='not reviewed';s.textContent='review panel unavailable';g.innerHTML='';return}if(reviewState.running){b.textContent='reviewing';s.textContent=reviewState.text||'checking the finished game with Stockfish…';g.innerHTML='';return}b.textContent=reviewState.accuracy+'% accuracy';s.textContent=reviewState.text||'';g.innerHTML='';for(const [k,v] of Object.entries(reviewState.counts||{})){const d=document.createElement('div');d.className='review-item';d.innerHTML='<b>'+v+'</b><span>'+k+'</span>';g.appendChild(d)}}

function recordMove(fenBefore,mv,actor){
  const fen=typeof fenBefore==='string'?fenBefore:(fenBefore&&typeof fenBefore.fen==='function'?fenBefore.fen():String(fenBefore||''));
  moveRecords.push({fen,uci:mv.from+mv.to+(mv.promotion||''),san:mv.san||game.history().at(-1)||'',side:fen.split(' ')[1]||game.turn(),actor,quality:null});
}

function renderTrainingVisual(){const root=document.getElementById('networkVisual');if(!root)return;const layers=[{n:Math.min(16,Math.max(4,Math.round(CONFIG.input/64))),label:CONFIG.input+' input'},{n:Math.min(32,Math.max(8,Math.round(CONFIG.hidden1/16))),label:CONFIG.hidden1+' trunk'},{n:Math.min(32,Math.max(8,CONFIG.residualBlocks*3)),label:CONFIG.residualBlocks+' residual blocks'},{n:Math.min(40,Math.max(10,Math.round(CONFIG.policy/128))),label:CONFIG.policy+' policy + value'}];if(!root.dataset.ready){root.innerHTML='';layers.forEach((l,li)=>{const col=document.createElement('div');col.className='net-layer';for(let j=0;j<l.n;j++){const node=document.createElement('span');node.className='net-node';node.style.setProperty('--d',(j*35+li*70)+'ms');col.appendChild(node)}const lab=document.createElement('small');lab.textContent=l.label;col.appendChild(lab);root.appendChild(col)});root.dataset.ready='1'}const active=training;root.classList.toggle('active',active);const state=document.getElementById('brainState');if(state)state.textContent=active?'learning':'idle';root.style.setProperty('--pulse',Math.min(1,trainingSpeed/20).toFixed(2));}
function renderTrainingLive(){
  const panel=document.querySelector('.training-controls-panel');
  if(!panel)return;
  panel.classList.toggle('is-training',!!training);
  const s=trainingLiveState||{};
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
  set('trainingLiveBadge',training?'learning':'idle');
  set('livePhase',training?(s.phase||'learning'):'waiting');
  set('liveDetail',training?(s.detail||'self-play → replay → gradient updates'):'start training to watch the learner learn');
  set('liveGames',games + (training ? ' · '+(s.game||0)+'/'+(s.totalGames||0) : ''));set('liveGamesRate',training&&trainingStartedAt?((games+((s.game||0)-0))/Math.max(.001,(performance.now()-trainingStartedAt)/60000)).toFixed(1):'0');
}
function renderStats(){document.getElementById('gamesStat').textContent=games;document.getElementById('stepsStat').textContent=steps;document.getElementById('replayStat')&&(document.getElementById('replayStat').textContent=replay.length);document.getElementById('generationBadge').textContent='gen '+generation;document.getElementById('evalStat')&&(document.getElementById('evalStat').textContent=evalRecord??'—');document.getElementById('pointsStat')&&(document.getElementById('pointsStat').textContent=points);document.getElementById('trainingElo')&&(document.getElementById('trainingElo').textContent=estimatedElo);document.getElementById('trainingTarget')&&(document.getElementById('trainingTarget').textContent=trainingTargetElo);document.getElementById('trainingSpeed')&&(document.getElementById('trainingSpeed').textContent=trainingSpeed?trainingSpeed.toFixed(1):'—');document.getElementById('brainState').textContent='gen '+generation+' · '+brain.w1.length+' weights'}

function renderAll(){renderPlayers();renderPlayers();renderBoard();renderMoves();renderTrainingVisual();renderTrainingLive();renderStats();renderReview();const t=terminalText(game);if(t)setStatus(t,'game finished');else if(!busy&&!training){const inCheck=isInCheck(game);setStatus(inCheck?'check':(botForTurn()==='human'?'your move':'ready'),inCheck?(botLabel(botForTurn())+' is in check'):'choose a matchup and press Play')}}