/* UCI engine bridge · Stockfish / custom WASM */
async function engineDisplayLabel(){
  if(selectedEngine==='custom-wasm')return 'Custom UCI WASM engine';
  return ENGINE_CONFIGS[selectedEngine]?.label||'Chess Engine';
}

function setEngineUi(label,ok){
  const pill=document.getElementById('enginePill'),dot=document.getElementById('onlineDot');
  if(pill)pill.textContent=label;
  if(dot)dot.style.background=ok?'var(--mint)':'var(--red)';
}

function createStockfish(force=false){
  if((stockfishWorker||stockfishLoading)&&!force)return;
  const cfg=ENGINE_CONFIGS[selectedEngine]||null;
  const previousWorker=stockfishWorker;
  const previousReady=stockfishReady;
  const engineUrl=selectedEngine==='custom-wasm'
    ?document.getElementById('customEngineUrl')?.value.trim()
    :cfg?.url?new URL(cfg.url,document.baseURI).href:'';
  if(!engineUrl){
    stockfishLoading=false;
    setEngineUi(previousReady?'previous engine ready':'Engine unavailable',previousReady);
    log(previousReady?'engine selection has no valid URL; keeping the working engine':'engine URL is missing');
    return;
  }
  if(cfg?.multi&&!window.crossOriginIsolated){
    stockfishLoading=false;
    setEngineUi(previousReady?'previous engine ready':'Multi-threaded engine unavailable',previousReady);
    log(cfg.label+' requires cross-origin isolation (COOP/COEP); keeping the current engine');
    return;
  }
  const requestedLabel=cfg?.label||'Custom UCI WASM engine';
  log('loading '+requestedLabel+' · '+engineUrl);
  stockfishLoading=true;
  let worker=null,settled=false;
  const fail=(reason)=>{
    if(settled)return;
    settled=true;
    stockfishLoading=false;
    try{worker?.terminate()}catch(e){}
    if(stockfishWorker===worker)stockfishWorker=null;
    if(previousWorker&&previousReady&&previousWorker!==worker){
      stockfishWorker=previousWorker;
      stockfishReady=true;
      setEngineUi('previous engine ready',true);
      log(requestedLabel+' failed; kept the previously working engine');
    }else{
      stockfishReady=false;
      setEngineUi(requestedLabel+' failed',false);
    }
    log('Engine worker error: '+reason);
  };
  try{
    worker=new Worker(engineUrl);
    stockfishWorker=worker;
    stockfishReady=false;
    worker.onmessage=e=>{
      const d=typeof e.data==='string'?e.data:'';
      if(!d)return;
      if(d.includes('uciok')){
        settled=true;
        stockfishReady=true;
        stockfishLoading=false;
        setEngineUi(requestedLabel+' ready',true);
        log(requestedLabel+' ready · local GitHub Pages worker');
        try{
          if(cfg?.multi)worker.postMessage('setoption name Threads value '+Math.max(1,navigator.hardwareConcurrency||2));
          worker.postMessage('isready');
        }catch(err){log('engine initialization command failed: '+err.message)}
        return;
      }
      if(d.includes('readyok'))stockfishReady=true;
      if(analysisActive){
        if(d.startsWith('info ')){
          const m=d.match(/score\\s+(cp|mate)\\s+(-?\\d+)/);
          if(m){const n=Number(m[2]);analysisActive.score=m[1]==='mate'?(n>0?100000:-100000):n;}
        }
        if(d.startsWith('bestmove')){const a=analysisActive;analysisActive=null;a.resolve({score:a.score??0,best:d.split(/\\s+/)[1]||null});return;}
      }
      if(d.startsWith('bestmove')){
        const m=d.split(/\\s+/)[1];
        const q=stockfishQueue.shift();
        stockfishActiveResolve=null;
        if(q)q(m);
      }
    };
    worker.onerror=e=>fail('message='+(e.message||'unknown')+' filename='+(e.filename||engineUrl)+' line='+(e.lineno||'?')+' col='+(e.colno||'?'));
    worker.onmessageerror=()=>fail('messageerror while communicating with the engine worker');
    worker.postMessage('uci');
    setTimeout(()=>{if(!settled&&stockfishWorker===worker)fail('timeout waiting for uciok')},20000);
  }catch(e){fail('constructor: '+e.message)}
}

function stockfishAnalyze(fen,depth=7){return new Promise(resolve=>{if(!stockfishReady||!stockfishWorker){resolve(null);return}analysisActive={resolve,score:null};stockfishWorker.postMessage('position fen '+fen);stockfishWorker.postMessage('go depth '+Math.max(4,Math.min(12,depth)));});}

function stockfishMove(c,depth=12,allowedMoves=null){return new Promise(resolve=>{if(!stockfishReady||!stockfishWorker){log('Stockfish is not ready');resolve(null);return}const legal=c.moves({verbose:true});const allowed=Array.isArray(allowedMoves)?allowedMoves:legal;const allowedUci=allowed.map(x=>x.from+x.to+(x.promotion||''));if(!allowedUci.length){resolve(null);return}const done=(uci)=>{const m=legal.find(x=>x.from+x.to+(x.promotion||'')===uci);resolve(m||null)};stockfishQueue.push(done);stockfishActiveResolve=()=>{const i=stockfishQueue.indexOf(done);if(i>=0)stockfishQueue.splice(i,1);resolve(null)};stockfishWorker.postMessage('ucinewgame');stockfishWorker.postMessage('position fen '+c.fen());stockfishWorker.postMessage('go depth '+depth+' searchmoves '+allowedUci.join(' '))})}

function cancelEngine(){cancelRequested=true;if(fastBatchAbort){const abort=fastBatchAbort;fastBatchAbort=null;abort()}else stopFastWorkers();if(stockfishWorker&&stockfishReady){try{stockfishWorker.postMessage('stop')}catch(e){}}if(stockfishActiveResolve){const r=stockfishActiveResolve;stockfishActiveResolve=null;r()}if(analysisActive){const a=analysisActive;analysisActive=null;a.resolve(null)}stockfishQueue.length=0;busy=false;}