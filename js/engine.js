/* UCI engine bridge · Stockfish / custom WASM */
function engineDisplayLabel(){
  if(selectedEngine==='custom-wasm')return 'Custom UCI WASM engine';
  return ENGINE_CONFIGS[selectedEngine]?.label||'Chess Engine';
}
function setEngineUi(label,ok){const pill=document.getElementById('enginePill'),dot=document.getElementById('onlineDot');if(pill)pill.textContent=label;if(dot)dot.style.background=ok?'var(--mint)':'var(--red)';}
let stockfishBlobUrls=[];
let nativeEngine=null;
let engineLoadedFromCache=false;

const ENGINE_CACHE_VERSION='stockfish-device-v1';

async function persistEngineStorage(){
  try{
    if(navigator.storage?.persist) await navigator.storage.persist();
  }catch(e){}
}

async function buildBundledEngineWorker(engineUrl){
  throw new Error('browser engine execution is disabled · Stockfish runs on the PC backend');
}

function cfgIsMultiEngine(engineUrl){
  return Object.values(ENGINE_CONFIGS||{}).some(cfg=>cfg?.multi&&new URL(cfg.url,document.baseURI).href===engineUrl);
}
async function createNativeEngine(cfg){
  const kind=cfg?.native;
  if(!kind)return false;
  if(kind==='tonnetto'){
    const mod=await import('https://cdn.jsdelivr.net/npm/tonnetto@1.0.2/dist/index.js');
    nativeEngine={kind,Engine:mod.default||mod.TonnettoEngine||mod};
  }else if(kind==='jce'){
    const mod=await import('https://esm.sh/js-chess-engine@2.4.6');
    nativeEngine={kind,Engine:mod.Game||mod.default?.Game};
  }
  if(!nativeEngine?.Engine)throw new Error('native engine module did not expose an engine');
  stockfishReady=true;stockfishLoading=false;setEngineUi(cfg.label+' ready',true);log(cfg.label+' ready · browser-native engine');return true;
}
async function waitForStockfish(timeout=125000){
  const deadline=Date.now()+Math.max(1000,Number(timeout)||125000);
  while(Date.now()<deadline){
    if(window.chessLabBackend?.role==='controller'){
      const connected=!!window.chessLabBackend.isConnected?.();
      stockfishReady=connected;
      setEngineUi(connected?'PC Stockfish backend ready':'PC backend offline',connected);
      if(connected)return true;
    }else if(stockfishReady)return true;
    await new Promise(r=>setTimeout(r,250));
  }
  return !!stockfishReady;
}
async function createStockfish(force=false){
  if(window.chessLabBackend?.role==='controller'){
    stockfishLoading=false;stockfishReady=!!window.chessLabBackend.isConnected?.();
    setEngineUi(stockfishReady?'PC Stockfish backend ready':'PC backend offline',stockfishReady);
    return;
  }
  if(window.chessLabBackend?.nativeCompute?.()){
    stockfishLoading=false;stockfishReady=true;
    setEngineUi('PC backend compute',true);
    return;
  }

  if((stockfishWorker||stockfishLoading)&&!force)return;
  const cfg=ENGINE_CONFIGS[selectedEngine]||null,previousWorker=stockfishWorker,previousReady=stockfishReady;
  const engineUrl=selectedEngine==='custom-wasm'?document.getElementById('customEngineUrl')?.value.trim():cfg?.url?new URL(cfg.url,document.baseURI).href:'';
  if(cfg?.native){stockfishLoading=true;try{await createNativeEngine(cfg)}catch(err){stockfishLoading=false;stockfishReady=false;setEngineUi(cfg.label+' failed',false);log(cfg.label+' load failed: '+err.message)}return;}
  if(!engineUrl){stockfishLoading=false;setEngineUi(previousReady?'previous engine ready':'Engine unavailable',previousReady);log(previousReady?'engine selection has no valid URL; keeping the working engine':'engine URL is missing');return;}
  if(cfg?.multi&&(!window.crossOriginIsolated||typeof SharedArrayBuffer==='undefined')){stockfishLoading=false;setEngineUi('Multi-threaded engine unavailable',false);log(cfg.label+' requires cross-origin isolation (COOP/COEP); reload once after the isolation service worker activates');return;}
  const requestedLabel=cfg?.label||'Custom UCI WASM engine';log('loading '+requestedLabel+' · '+engineUrl);stockfishLoading=true;let worker=null,settled=false;
  const fail=(reason)=>{if(settled)return;settled=true;stockfishLoading=false;try{worker?.terminate()}catch(e){}if(stockfishWorker===worker)stockfishWorker=null;stockfishReady=false;setEngineUi(requestedLabel+' failed',false);log('Engine worker error: '+reason);};
  try{
    worker=await buildBundledEngineWorker(engineUrl);if(settled){try{worker.terminate()}catch(e){}return;}stockfishWorker=worker;stockfishReady=false;
    worker.onmessage=e=>{const d=typeof e.data==='string'?e.data:'';if(!d)return;if(d.startsWith('ENGINE_ERROR:')){fail(d.slice(13).trim()||'engine initialization failed');return;}if(d.includes('uciok')){settled=true;stockfishReady=true;stockfishLoading=false;setEngineUi(requestedLabel+(engineLoadedFromCache?' · cached':' ready'),true);log(requestedLabel+' ready · '+(engineLoadedFromCache?'loaded from local cache':'local GitHub Pages worker'));try{if(cfg?.multi)worker.postMessage('setoption name Threads value '+Math.max(1,navigator.hardwareConcurrency||2));worker.postMessage('isready');}catch(err){log('engine initialization command failed: '+err.message)}return;}if(d.includes('readyok')&&settled)stockfishReady=true;if(analysisActive){if(d.startsWith('info ')){const m=d.match(/score\s+(cp|mate)\s+(-?\d+)/);if(m){const n=Number(m[2]);analysisActive.score=m[1]==='mate'?(n>0?100000:-100000):n;}}if(d.startsWith('bestmove')){const a=analysisActive;analysisActive=null;a.resolve({score:a.score??0,best:d.split(/\s+/)[1]||null});return;}}if(d.startsWith('bestmove')){const m=d.split(/\s+/)[1],q=stockfishQueue.shift();stockfishActiveResolve=null;if(q)q(m);}};
    worker.onerror=e=>fail('message='+(e.message||'unknown')+' filename='+(e.filename||engineUrl)+' line='+(e.lineno||'?')+' col='+(e.colno||'?'));worker.onmessageerror=()=>fail('messageerror while communicating with the engine worker');worker.postMessage('uci');setTimeout(()=>{if(!settled&&stockfishWorker===worker)fail('timeout waiting for uciok after 120 seconds · engine file may not be deployed')},120000);
  }catch(e){fail('constructor: '+e.message)}
}
function stockfishAnalyze(fen,depth=7){return new Promise(async resolve=>{if(selectedEngine==='tonnetto'||selectedEngine==='js-chess-engine'){try{const m=await nativeBestMove(fen,depth);resolve(m?{score:0,best:m}:null)}catch(e){resolve(null)}return}if(!stockfishReady||!stockfishWorker){resolve(null);return}analysisActive={resolve,score:null};stockfishWorker.postMessage('position fen '+fen);stockfishWorker.postMessage('go depth '+Math.max(4,Math.min(12,depth)));});}
function stockfishSetStrength(full=true){if(selectedEngine==='tonnetto'||selectedEngine==='js-chess-engine')return;if(!stockfishReady||!stockfishWorker)return;try{stockfishWorker.postMessage('setoption name UCI_LimitStrength value '+(!full));if(full)stockfishWorker.postMessage('setoption name UCI_Elo value 3000');stockfishWorker.postMessage('isready')}catch(e){log('engine strength reset failed: '+e.message)}}
async function nativeBestMove(fen,depth=6){
  if(!nativeEngine)throw new Error('native engine is not loaded');
  if(nativeEngine.kind==='tonnetto'){const eng=new nativeEngine.Engine({fen});const mv=eng.getBestMove(Math.max(1,Math.min(6,depth)));return typeof mv==='string'?mv:(mv?.uci||mv?.from+mv?.to||null)}
  const game=new nativeEngine.Engine(fen);const obj=game.aiMove(Math.max(0,Math.min(4,Math.floor(depth/2))));const entry=Object.entries(obj||{})[0];if(!entry)return null;let u=entry[0].toLowerCase()+entry[1].toLowerCase();if((u[1]==='7'&&u[3]==='8')||(u[1]==='2'&&u[3]==='1'))u+='q';return u;
}
function stockfishMove(c,depth=12,allowedMoves=null){return new Promise(async resolve=>{
  const legal=c.moves({verbose:true}),allowed=Array.isArray(allowedMoves)?allowedMoves:legal;
  if(window.chessLabBackend?.role==='controller'||window.chessLabBackend?.nativeCompute?.()){
    try{const uci=await window.chessLabBackend.getEngineMove(c.fen(),depth,allowed);resolve(legal.find(x=>x.from+x.to+(x.promotion||'')===uci)||null)}
    catch(e){log('PC Stockfish request failed: '+e.message);resolve(null)}
    return;
  }
  if(selectedEngine==='tonnetto'||selectedEngine==='js-chess-engine'){
    try{const uci=await nativeBestMove(c.fen(),depth);resolve(legal.find(x=>x.from+x.to+(x.promotion||'')===uci)||null)}catch(e){resolve(null)}
    return;
  }
  if(!stockfishReady||!stockfishWorker){log('Stockfish is not ready');resolve(null);return}
  const allowedUci=allowed.map(x=>x.from+x.to+(x.promotion||''));if(!allowedUci.length){resolve(null);return}
  const done=uci=>resolve(legal.find(x=>x.from+x.to+(x.promotion||'')===uci)||null);
  stockfishQueue.push(done);stockfishActiveResolve=()=>{const i=stockfishQueue.indexOf(done);if(i>=0)stockfishQueue.splice(i,1);resolve(null)};
  stockfishWorker.postMessage('ucinewgame');stockfishWorker.postMessage('position fen '+c.fen());stockfishWorker.postMessage('go depth '+depth+' searchmoves '+allowedUci.join(' '))
})}
function cancelEngine(){cancelRequested=true;if(fastBatchAbort){const abort=fastBatchAbort;fastBatchAbort=null;abort()}else stopFastWorkers();if(stockfishWorker&&stockfishReady){try{stockfishWorker.postMessage('stop')}catch(e){}}if(stockfishActiveResolve){const r=stockfishActiveResolve;stockfishActiveResolve=null;r()}if(analysisActive){const a=analysisActive;analysisActive=null;a.resolve(null)}stockfishQueue.length=0;busy=false;}
