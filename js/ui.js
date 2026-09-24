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

  function remoteTrainingConfig(){
  const num=(id,f)=>{const n=Number($(id)?.value);return Number.isFinite(n)?n:f};
  return {mode:$('trainingMode')?.value||'generation',opponent:$('trainOpponent')?.value||'self',games:num('batchGames',100),maxPlies:num('trainSims',300),parallelGames:num('parallelGames',4),sims:num('learnerSims',8),updates:num('trainUpdates',400),lr:num('mutationRate',0.001),replaySize:num('replaySize',50000),batchSize:num('trainBatchSize',64),mixRatio:num('mixRatio',25),targetElo:num('targetElo',1800),evalGames:num('evalGames',10),evalPlies:num('evalPlies',300),stockfishDepth:num('stockfishDepth',12),stockfishThreads:$('stockfishThreads')?.value||'auto'};
}
function trainingLogLine(message){const root=$('trainingLog');if(!root)return;root.textContent+='['+new Date().toLocaleTimeString()+'] '+String(message)+'\n';root.scrollTop=root.scrollHeight}
function setTrainingConfigVisibility(){const mode=$('trainingMode')?.value||'generation',opp=$('trainOpponent')?.value||'self';if($('targetEloField'))$('targetEloField').style.display=mode==='target'?'grid':'none';if($('mixRatioField'))$('mixRatioField').style.display=opp==='mix'?'grid':'none'}
function setTrainingButtonState(running){if($('startTraining'))$('startTraining').disabled=running;if($('pauseTraining'))$('pauseTraining').disabled=!running;if($('stopTraining'))$('stopTraining').disabled=!running}
$('startTraining')?.addEventListener('click',()=>{if(!window.chessLabBackend?.command){toast('PC backend is unavailable');return}const config=remoteTrainingConfig();if(!window.chessLabBackend.command('start-training',config)){toast('PC backend is offline');return}trainingLogLine('training run requested');setTrainingButtonState(true);toast('training started')});
$('pauseTraining')?.addEventListener('click',()=>{if(window.chessLabBackend?.command('pause-training')){trainingLogLine('pause requested');toast('pause requested')}});
$('resumeTraining')?.addEventListener('click',()=>{if(window.chessLabBackend?.command('resume-training')){trainingLogLine('resume requested');toast('resume requested')}});
$('stopTraining')?.addEventListener('click',()=>{if(window.chessLabBackend?.command('stop-training')){trainingLogLine('stop requested');toast('stop requested')}});
$('checkpointTraining')?.addEventListener('click',()=>{if(window.chessLabBackend?.command('checkpoint-training')){trainingLogLine('checkpoint requested');toast('checkpoint requested')}});
$('clearTrainingLog')?.addEventListener('click',()=>{if($('trainingLog'))$('trainingLog').textContent=''});
$('trainingMode')?.addEventListener('change',setTrainingConfigVisibility);$('trainOpponent')?.addEventListener('change',setTrainingConfigVisibility);setTrainingConfigVisibility();
  $('playMatch')?.addEventListener('click',()=>playMatch().catch(e=>{busy=false;log('Play error: '+e.message);setStatus('error',e.message,0);renderAll()}));
  $('simulateMove')?.addEventListener('click',()=>simulateOneMove().catch(e=>{busy=false;log('1 move error: '+e.message);setStatus('error',e.message,0);renderAll()}));
  $('newGame')?.addEventListener('click',()=>newGame());
  $('flip')?.addEventListener('click',()=>{flipped=!flipped;renderBoard()});
  $('stopTrain')?.addEventListener('click',()=>{cancelEngine();training=false;busy=false;setStatus('paused','stopped');renderAll();toast('stopped')});
  $('trainingMode')?.addEventListener('change',()=>{const e=$('targetEloField');if(e)e.style.display=$('trainingMode').value==='target'?'grid':'none';renderStats()});
  $('trainOpponent')?.addEventListener('change',()=>{const e=$('mixRatioField');if(e)e.style.display=$('trainOpponent').value==='mix'?'grid':'none'});
  $('matchType')?.addEventListener('change',()=>{const type=$('matchType')?.value||'learner-learner';$('engineField').style.display=type==='learner-engine'?'grid':'none';updateMatchBadge();setStatus('ready','press Play to randomize sides and start the match',0)});
  $('engineSelect')?.addEventListener('change',async()=>{selectedEngine=$('engineSelect').value;const custom=$('customEngineField');if(custom)custom.style.display=selectedEngine==='custom-wasm'?'grid':'none';matchEpoch++;setEngineUi('loading '+engineDisplayLabel(),false);await createStockfish(true);updateMatchBadge();setStatus(stockfishReady?'ready':'engine unavailable',stockfishReady?engineDisplayLabel()+' ready':'could not start '+engineDisplayLabel(),0)});
  $('customEngineUrl')?.addEventListener('change',async()=>{if(selectedEngine==='custom-wasm'){matchEpoch++;await createStockfish(true)}});
  $('saveBrain')?.addEventListener('click',()=>saveBrain());$('loadBrain')?.addEventListener('click',loadBrain);$('restoreChampion')?.addEventListener('click',()=>restoreChampionSnapshot().catch(e=>{log('champion restore error: '+e.message)}));$('resetBrain')?.addEventListener('click',resetBrain);$('exportBrain')?.addEventListener('click',exportBrain);$('importBrain')?.addEventListener('click',importBrain);
  $('promoModal')?.addEventListener('click',e=>{if(e.target.id==='promoModal')e.currentTarget.classList.remove('open')});

  const tm=$('trainingMode');if(tm){const e=$('targetEloField');if(e)e.style.display=tm.value==='target'?'grid':'none'}
  const to=$('trainOpponent');if(to){const e=$('mixRatioField');if(e)e.style.display=to.value==='mix'?'grid':'none'}
})();
(function(){
  const b=window.chessLabBackend;if(!b)return;
  b.on('connection',m=>{if(m?.connected){log((m.role||'PC')+' backend connected');const a=document.getElementById('overviewBackend');if(a)a.textContent='ONLINE'}else{log((m.role||'PC')+' backend disconnected');const a=document.getElementById('overviewBackend');if(a)a.textContent='OFFLINE'}});
  b.on('backend-info',s=>{
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=String(v)};
    set('overviewBackend',s?.apiOnline?'ONLINE':'OFFLINE');
    set('computeStatus',s?.nativeCompute?'READY':'UNAVAILABLE');
    set('backendUrl',b.getUrl?.()||location.origin);
    const sf=s?.stockfishInfo;
    set('overviewStockfish',sf?.available?'STOCKFISH 19':'UNAVAILABLE');
    set('footerBackend',s?.apiOnline?'ONLINE':'OFFLINE');
    set('footerStockfish',sf?.available?'19':'MISSING');
  });
  b.on('status',s=>{
  if(!s)return;
  const pct=s.totalGames?Math.round(Number(s.game||0)/Number(s.totalGames)*100):0;
  if(s.error)setStatus('error',String(s.error),pct);else setStatus(s.training?'training':'ready',s.training?((s.phase||'training')+' · '+(s.game||0)+' / '+(s.totalGames||0)):'PC backend connected',pct);
  const set=(id,v)=>{const el=$(id);if(el)el.textContent=String(v)};
  set('liveGames',(s.game||0)+' / '+(s.totalGames||0));set('liveGamesRate',s.gamesPerMinute||0);set('livePositions',s.positions||0);set('liveUpdates',(s.updates||0)+' / '+(s.totalUpdates||0));set('livePly',s.ply||0);set('liveTurn',(s.turn==='b'?'black':'white')+' to move');set('livePhase',s.phase||'waiting');set('liveDetail',s.error||((s.phase||'waiting')+(s.training?'':' · ready')));set('liveLoss',Number.isFinite(Number(s.loss))?Number(s.loss).toFixed(4):'—');set('generationBadge','gen '+(s.generation||0));set('trainingGenerationText','generation '+(s.generation||0));set('generationGames',s.completedGames||s.game||0);set('generationPositions',s.completedPositions||s.positions||0);set('generationLoss',Number.isFinite(Number(s.completedLoss))?Number(s.completedLoss).toFixed(4):'—');
  const ev=s.evaluation;if(ev){const total=Number(ev.games||0),score=total?((Number(ev.wins||0)+Number(ev.draws||0)*.5)/total*100):0;set('generationScore',total?score.toFixed(1)+'%':'—');set('evaluationBadge',total?'evaluated':'not evaluated');set('evaluationLine',total?('Stockfish 19: '+ev.wins+'W · '+ev.draws+'D · '+ev.losses+'L · '+score.toFixed(1)+'% score'):(ev.error||'evaluation unavailable'))}
  const progress=s.phase==='training'?(s.totalUpdates?Math.round(Number(s.updates||0)/Number(s.totalUpdates)*100):0):pct;const bar=$('trainingProgressBar');if(bar)bar.style.width=Math.max(0,Math.min(100,progress))+'%';set('trainingProgressText',Math.max(0,Math.min(100,progress))+'%');setTrainingButtonState(!!s.training);if(s.fen)renderTrainingLiveBoard(s.fen);
  if(Array.isArray(s.history)){const root=$('trainingHistory');if(root){root.innerHTML=s.history.length?s.history.slice().reverse().map(h=>{const ev=h.evaluation||{};const total=Number(ev.games||0),score=total?((Number(ev.wins||0)+Number(ev.draws||0)*.5)/total*100):null;return '<div class="history-row"><b>gen '+h.generation+'</b><span>'+h.games+' games</span><span>'+h.positions+' positions</span><span>loss '+(Number.isFinite(Number(h.loss))?Number(h.loss).toFixed(4):'—')+'</span><span>'+ (score==null?'—':score.toFixed(1)+'% SF') +'</span></div>'}).join(''):'<div class="history-empty">No completed generations yet.</div>'}}
  if(s.phase==='generation-complete')trainingLogLine('generation '+(s.generation||0)+' completed');if(s.phase==='error')trainingLogLine('ERROR: '+(s.error||'unknown training error'));
});
  b.on('command',m=>{
    if(b.role!=='compute')return;
    if(b.nativeCompute?.())return;
    if(m.command==='start-training'){
      applyRemoteTrainingConfig(m.data||{});
      trainBatch().catch(e=>{log('remote training launch error: '+e.message);setStatus('error',e.message,0)})
    }else if(m.command==='stop-training'){
      cancelRequested=true;cancelEngine();training=false;busy=false;setStatus('paused','remote training stopped',0);renderStats()
    }else if(m.command==='request-status'){ /* next heartbeat publishes state */ }
  });
})();/* Panels, moves, review and status rendering */
function renderMoves(){const list=document.getElementById('moveList'),hist=game.history();if(!list)return;list.innerHTML='';for(let i=0;i<hist.length;i++){const d=document.createElement('div');d.className='move';const q=moveRecords[i]?.quality||'';const pd=moveRecords[i]?.pointDelta;d.innerHTML='<b>'+((i>>1)+1)+(i%2?'...':'.')+'</b>'+hist[i]+(q?' <span style="float:right;font-weight:900">'+q+(Number.isFinite(pd)?' '+(pd>=0?'+':'')+pd:'')+'</span>':'');list.appendChild(d)}document.getElementById('moveCount').textContent=hist.length+' plies'}

function renderReview(){const b=document.getElementById('reviewBadge'),s=document.getElementById('reviewSummary'),g=document.getElementById('reviewGrid');if(!b||!s||!g)return;if(!reviewState){b.textContent='not reviewed';s.textContent='review panel unavailable';g.innerHTML='';return}if(reviewState.running){b.textContent='reviewing';s.textContent=reviewState.text||'checking the finished game with Stockfish…';g.innerHTML='';return}b.textContent=reviewState.accuracy+'% accuracy';s.textContent=reviewState.text||'';g.innerHTML='';for(const [k,v] of Object.entries(reviewState.counts||{})){const d=document.createElement('div');d.className='review-item';d.innerHTML='<b>'+v+'</b><span>'+k+'</span>';g.appendChild(d)}}

function recordMove(fenBefore,mv,actor){
  const fen=typeof fenBefore==='string'?fenBefore:(fenBefore&&typeof fenBefore.fen==='function'?fenBefore.fen():String(fenBefore||''));
  moveRecords.push({fen,uci:mv.from+mv.to+(mv.promotion||''),san:mv.san||game.history().at(-1)||'',side:fen.split(' ')[1]||game.turn(),actor,quality:null});
}

function renderTrainingVisual(){const root=document.getElementById('networkVisual');if(!root)return;const layers=[{n:Math.min(16,Math.max(4,Math.round(CONFIG.input/64))),label:CONFIG.input+' input'},{n:Math.min(32,Math.max(8,Math.round(CONFIG.hidden1/16))),label:CONFIG.hidden1+' trunk'},{n:Math.min(32,Math.max(8,CONFIG.residualBlocks*3)),label:CONFIG.residualBlocks+' residual blocks'},{n:Math.min(40,Math.max(10,Math.round(CONFIG.policy/128))),label:CONFIG.policy+' policy + value'}];if(!root.dataset.ready){root.innerHTML='';layers.forEach((l,li)=>{const col=document.createElement('div');col.className='net-layer';for(let j=0;j<l.n;j++){const node=document.createElement('span');node.className='net-node';node.style.setProperty('--d',(j*35+li*70)+'ms');col.appendChild(node)}const lab=document.createElement('small');lab.textContent=l.label;col.appendChild(lab);root.appendChild(col)});root.dataset.ready='1'}const active=training;root.classList.toggle('active',active);const state=document.getElementById('brainState');if(state)state.textContent=active?'learning':'idle';root.style.setProperty('--pulse',Math.min(1,trainingSpeed/20).toFixed(2));}
function renderTrainingLiveBoard(fen){
  const root=document.getElementById('trainingLiveBoard');if(!root||!fen||fen==='start')return;
  const board=String(fen).split(' ')[0];const rows=board.split('/');
  if(rows.length!==8)return;
  root.innerHTML='';
  rows.forEach((row,r)=>{
    let file=0;
    for(const ch of row){
      const count=/[1-8]/.test(ch)?Number(ch):1;
      for(let i=0;i<count;i++){
        const sq=document.createElement('div');sq.className='training-live-square '+(((r+file)&1)?'dark':'light');
        if(!/[1-8]/.test(ch))sq.textContent=PIECES[ch]||ch;
        root.appendChild(sq);file++;
      }
    }
  });
}
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
function renderStats(){const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=String(v)};set('gamesStat',games);set('stepsStat',steps);set('replayStat',replay.length);set('generationBadge','gen '+generation);set('evalStat',evalRecord??'—');set('pointsStat',points);set('trainingElo',estimatedElo);set('trainingTarget',trainingTargetElo);set('trainingSpeed',trainingSpeed?trainingSpeed.toFixed(1):'—');set('footerGeneration',generation);set('brainState','gen '+generation+' · '+(brain?.w1?.length||0)+' weights')}

function renderAll(){renderPlayers();renderPlayers();renderBoard();renderMoves();renderTrainingVisual();renderTrainingLive();renderStats();renderReview();const t=terminalText(game);if(t)setStatus(t,'game finished');else if(!busy&&!training){const inCheck=isInCheck(game);setStatus(inCheck?'check':(botForTurn()==='human'?'your move':'ready'),inCheck?(botLabel(botForTurn())+' is in check'):'choose a matchup and press Play')}}