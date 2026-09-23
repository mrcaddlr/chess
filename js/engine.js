/* UCI engine bridge · Stockfish / custom WASM */
function engineDisplayLabel(){
  if(selectedEngine==='custom-wasm')return 'Custom UCI WASM engine';
  return ENGINE_CONFIGS[selectedEngine]?.label||'Chess Engine';
}
function setEngineUi(label,ok){const pill=document.getElementById('enginePill'),dot=document.getElementById('onlineDot');if(pill)pill.textContent=label;if(dot)dot.style.background=ok?'var(--mint)':'var(--red)';}
let stockfishBlobUrls=[];
let nativeEngine=null;
function waitForStockfish(timeout=125000){return new Promise(resolve=>{if(stockfishReady){resolve(true);return}const started=Date.now();const timer=setInterval(()=>{if(stockfishReady||Date.now()-started>=timeout){clearInterval(timer);resolve(stockfishReady)}},100)})}
async function buildBundledEngineWorker(engineUrl){
  const manifestUrl=new URL('stockfish/engine-manifest.json',document.baseURI).href;
  let manifest=null;
  try{
    const r=await fetch(manifestUrl,{cache:'no-store'});
    if(r.ok)manifest=await r.json();
  }catch(err){log('engine manifest fetch failed: '+err.message)}

  if(engineUrl.endsWith('/lozza.js')){
    log('loading Lozza · native UCI worker');
    return new Worker(engineUrl);
  }

  const jsName=engineUrl.split('/').pop();
  const wasmName=jsName.replace(/\\.js$/i,'.wasm');
  const parts=manifest?.[wasmName];
  let wasmUrl='';

  if(Array.isArray(parts)&&parts.length){
    log('assembling '+wasmName+' from '+parts.length+' chunks');

    // Keep the chunks as Blob parts instead of copying them into a second
    // 100MB Uint8Array. This matters on Android, where the old approach could
    // briefly require 200MB+ just to start the full single-threaded engine.
    const blobs=[];
    let total=0;

    for(let i=0;i<parts.length;i++){
      const part=String(parts[i]||'').replace(/^\/+/, '');
      const url=new URL('stockfish/'+part,document.baseURI);
      url.searchParams.set('v','0.31.14');
      const r=await fetch(url.href,{cache:'no-store'});
      if(!r.ok)throw new Error('Stockfish chunk '+part+' returned HTTP '+r.status);

      const data=new Uint8Array(await r.arrayBuffer());
      if(!data.byteLength)throw new Error('Stockfish chunk '+part+' is empty');
      if(i===0&&data.length>=4&&!(data[0]===0x00&&data[1]===0x61&&data[2]===0x73&&data[3]===0x6d)){
        throw new Error('Stockfish chunk '+part+' is not the start of a WASM binary');
      }

      blobs.push(data);
      total+=data.byteLength;
      log('chunk '+(i+1)+'/'+parts.length+' loaded · '+Math.round(data.byteLength/1048576)+' MiB');
    }

    if(total<1024*1024)throw new Error('assembled '+wasmName+' is only '+total+' bytes; incomplete WASM bundle');

    wasmUrl=URL.createObjectURL(new Blob(blobs,{type:'application/wasm'}));
  }else{
    // Stockfish.js itself looks for "stockfish.wasm". Our files have
    // engine-specific names, so always provide locateFile even for lite builds.
    wasmUrl=new URL('stockfish/'+wasmName,document.baseURI).href;
    log('using direct WASM '+wasmName);
  }

  const jsResponse=await fetch(engineUrl,{cache:'no-store'});
  if(!jsResponse.ok)throw new Error('engine JavaScript file returned HTTP '+jsResponse.status);
  const source=await jsResponse.text();
  const wasmLiteral=JSON.stringify(wasmUrl);
  let pthreadWorkerUrl='';

  if(cfgIsMultiEngine(engineUrl)){
    const pthreadBootstrap='var Module=self.Module=self.Module||{};Module.locateFile=function(path){if(/\\\\.wasm$/i.test(path))return '+wasmLiteral+';return new URL(path,'+JSON.stringify(engineUrl)+').href;};\\n'+source;
    pthreadWorkerUrl=URL.createObjectURL(new Blob([pthreadBootstrap],{type:'text/javascript'}));
    stockfishBlobUrls.push(pthreadWorkerUrl);
  }

  const bootstrap='var Module=self.Module=self.Module||{};Module.locateFile=function(path){if(/stockfish\\\\.worker\\\\.js$/i.test(path)&&'+JSON.stringify(pthreadWorkerUrl)+')return '+JSON.stringify(pthreadWorkerUrl)+';if(/\\\\.wasm$/i.test(path))return '+wasmLiteral+';return new URL(path,'+JSON.stringify(engineUrl)+').href;};\\n'+source;
  const workerUrl=URL.createObjectURL(new Blob([bootstrap],{type:'text/javascript'}));
  stockfishBlobUrls.push(workerUrl);
  if(wasmUrl.startsWith('blob:'))stockfishBlobUrls.push(wasmUrl);
  return new Worker(workerUrl);
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
async function createStockfish(force=false){
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
    worker.onmessage=e=>{const d=typeof e.data==='string'?e.data:'';if(!d)return;if(d.includes('uciok')){settled=true;stockfishReady=true;stockfishLoading=false;setEngineUi(requestedLabel+' ready',true);log(requestedLabel+' ready · local GitHub Pages worker');try{if(cfg?.multi)worker.postMessage('setoption name Threads value '+Math.max(1,navigator.hardwareConcurrency||2));worker.postMessage('isready');}catch(err){log('engine initialization command failed: '+err.message)}return;}if(d.includes('readyok'))stockfishReady=true;if(analysisActive){if(d.startsWith('info ')){const m=d.match(/score\s+(cp|mate)\s+(-?\d+)/);if(m){const n=Number(m[2]);analysisActive.score=m[1]==='mate'?(n>0?100000:-100000):n;}}if(d.startsWith('bestmove')){const a=analysisActive;analysisActive=null;a.resolve({score:a.score??0,best:d.split(/\s+/)[1]||null});return;}}if(d.startsWith('bestmove')){const m=d.split(/\s+/)[1],q=stockfishQueue.shift();stockfishActiveResolve=null;if(q)q(m);}};
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
function stockfishMove(c,depth=12,allowedMoves=null){return new Promise(async resolve=>{if(selectedEngine==='tonnetto'||selectedEngine==='js-chess-engine'){try{const legal=c.moves({verbose:true}),allowed=Array.isArray(allowedMoves)?allowedMoves:legal,uci=await nativeBestMove(c.fen(),depth),m=legal.find(x=>x.from+x.to+(x.promotion||'')===uci);resolve(m||null)}catch(e){log('native engine move failed: '+e.message);resolve(null)}return}if(!stockfishReady||!stockfishWorker){log('Stockfish is not ready');resolve(null);return}const legal=c.moves({verbose:true}),allowed=Array.isArray(allowedMoves)?allowedMoves:legal,allowedUci=allowed.map(x=>x.from+x.to+(x.promotion||''));if(!allowedUci.length){resolve(null);return}const done=uci=>{const m=legal.find(x=>x.from+x.to+(x.promotion||'')===uci);resolve(m||null)};stockfishQueue.push(done);stockfishActiveResolve=()=>{const i=stockfishQueue.indexOf(done);if(i>=0)stockfishQueue.splice(i,1);resolve(null)};stockfishWorker.postMessage('ucinewgame');stockfishWorker.postMessage('position fen '+c.fen());stockfishWorker.postMessage('go depth '+depth+' searchmoves '+allowedUci.join(' '))})}
function cancelEngine(){cancelRequested=true;if(fastBatchAbort){const abort=fastBatchAbort;fastBatchAbort=null;abort()}else stopFastWorkers();if(stockfishWorker&&stockfishReady){try{stockfishWorker.postMessage('stop')}catch(e){}}if(stockfishActiveResolve){const r=stockfishActiveResolve;stockfishActiveResolve=null;r()}if(analysisActive){const a=analysisActive;analysisActive=null;a.resolve(null)}stockfishQueue.length=0;busy=false;}
