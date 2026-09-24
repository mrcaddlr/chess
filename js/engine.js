/* UCI engine bridge · Stockfish / custom WASM */
function engineDisplayLabel(){
  if(selectedEngine==='custom-wasm')return 'Custom UCI WASM engine';
  return ENGINE_CONFIGS[selectedEngine]?.label||'Chess Engine';
}
function setEngineUi(label,ok){const pill=document.getElementById('enginePill'),dot=document.getElementById('onlineDot');if(pill)pill.textContent=label;if(dot)dot.style.background=ok?'var(--mint)':'var(--red)';}
let stockfishBlobUrls=[];
let nativeEngine=null;

const ENGINE_CACHE_VERSION='stockfish-cache-v1';
const engineWasmCache={
  db:null,
  async open(){
    if(this.db)return this.db;
    this.db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open('chess-lab-engine-cache',1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('wasm'))req.result.createObjectStore('wasm')};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('IndexedDB unavailable'));
    });
    return this.db;
  },
  async get(key){
    try{
      const db=await this.open();
      return await new Promise((resolve,reject)=>{
        const req=db.transaction('wasm','readonly').objectStore('wasm').get(key);
        req.onsuccess=()=>resolve(req.result||null);
        req.onerror=()=>reject(req.error);
      });
    }catch(e){log('engine cache read failed: '+e.message);return null}
  },
  async put(key,bytes){
    try{
      const db=await this.open();
      await new Promise((resolve,reject)=>{
        const req=db.transaction('wasm','readwrite').objectStore('wasm').put(bytes,key);
        req.onsuccess=()=>resolve();
        req.onerror=()=>reject(req.error);
      });
      return true;
    }catch(e){log('engine cache write failed: '+e.message);return false}
  }
};
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

  if(engineUrl.endsWith('/fairy-stockfish.js')){
    const wasmUrl=new URL('stockfish/fairy-stockfish.wasm',document.baseURI).href;
    const workerHelperUrl=new URL('stockfish/fairy-stockfish.worker.js',document.baseURI).href;
    const bootstrap=`
      self.Module=self.Module||{};
      self.Module.locateFile=function(path){
        if(/\\.wasm$/i.test(path))return ${JSON.stringify(wasmUrl)};
        if(/stockfish\\.worker\\.js$/i.test(path))return ${JSON.stringify(workerHelperUrl)};
        return ${JSON.stringify(engineUrl)};
      };
      importScripts(${JSON.stringify(engineUrl)});
      Promise.resolve(Stockfish(self.Module)).then(function(sf){
        self.__sf=sf;
        sf.addMessageListener(function(line){self.postMessage(line);});
        self.onmessage=function(e){sf.postMessage(e.data);};
      }).catch(function(err){
        self.postMessage('ENGINE_ERROR: '+(err&&err.message||String(err)));
      });
    `;
    const workerUrl=URL.createObjectURL(new Blob([bootstrap],{type:'text/javascript'}));
    stockfishBlobUrls.push(workerUrl);
    log('loading Fairy-Stockfish · bundled NNUE WASM worker');
    return new Worker(workerUrl);
  }

  const jsName=engineUrl.split('/').pop();
  const wasmName=jsName.replace(/\\.js$/i,'.wasm');
  const parts=manifest?.[wasmName];
  let wasmUrl='';

  if(Array.isArray(parts)&&parts.length){
    const cacheKey=ENGINE_CACHE_VERSION+':'+wasmName+':'+parts.join('|');
    const cached=await engineWasmCache.get(cacheKey);
    if(cached){
      wasmUrl=URL.createObjectURL(new Blob([cached],{type:'application/wasm'}));
      stockfishBlobUrls.push(wasmUrl);
      log(wasmName+' loaded from local cache · no download needed');
    }else{
      log('downloading '+wasmName+' for first use · '+parts.length+' chunks');
      const blobs=[];
      let total=0;
      for(let i=0;i<parts.length;i++){
        const part=String(parts[i]||'').replace(/^\/+/, '');
        const url=new URL('stockfish/'+part,document.baseURI);
        const r=await fetch(url.href,{cache:'force-cache'});
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
      const combined=new Uint8Array(total);
      let offset=0;
      for(const data of blobs){combined.set(data,offset);offset+=data.byteLength}
      await engineWasmCache.put(cacheKey,combined.buffer);
      wasmUrl=URL.createObjectURL(new Blob([combined],{type:'application/wasm'}));
      stockfishBlobUrls.push(wasmUrl);
      log(wasmName+' cached locally for future visits');
    }
  }else{
    const directUrl=new URL('stockfish/'+wasmName,document.baseURI).href;
    const cacheKey=ENGINE_CACHE_VERSION+':direct:'+wasmName;
    const cached=await engineWasmCache.get(cacheKey);
    if(cached){
      wasmUrl=URL.createObjectURL(new Blob([cached],{type:'application/wasm'}));
      stockfishBlobUrls.push(wasmUrl);
      log(wasmName+' loaded from local cache · no download needed');
    }else{
      const r=await fetch(directUrl,{cache:'force-cache'});
      if(!r.ok)throw new Error(wasmName+' returned HTTP '+r.status);
      const data=await r.arrayBuffer();
      await engineWasmCache.put(cacheKey,data);
      wasmUrl=URL.createObjectURL(new Blob([data],{type:'application/wasm'}));
      stockfishBlobUrls.push(wasmUrl);
      log(wasmName+' downloaded once and cached locally');
    }
  }

  // Stockfish.js 19 already contains its browser UCI-worker bootstrap.
  // Launch it directly with the WASM URL in the worker fragment. This avoids
  // blob-relative paths, which previously prevented uciok from being emitted.
  const launchUrl=engineUrl+'#'+encodeURIComponent(wasmUrl)+',worker';
  log('starting '+jsName+' with explicit WASM worker URL');
  return new Worker(launchUrl);
}function cfgIsMultiEngine(engineUrl){
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
    worker.onmessage=e=>{const d=typeof e.data==='string'?e.data:'';if(!d)return;if(d.startsWith('ENGINE_ERROR:')){fail(d.slice(13).trim()||'engine initialization failed');return;}if(d.includes('uciok')){settled=true;stockfishReady=true;stockfishLoading=false;setEngineUi(requestedLabel+' ready',true);log(requestedLabel+' ready · local GitHub Pages worker');try{if(cfg?.multi)worker.postMessage('setoption name Threads value '+Math.max(1,navigator.hardwareConcurrency||2));worker.postMessage('isready');}catch(err){log('engine initialization command failed: '+err.message)}return;}if(d.includes('readyok')&&settled)stockfishReady=true;if(analysisActive){if(d.startsWith('info ')){const m=d.match(/score\s+(cp|mate)\s+(-?\d+)/);if(m){const n=Number(m[2]);analysisActive.score=m[1]==='mate'?(n>0?100000:-100000):n;}}if(d.startsWith('bestmove')){const a=analysisActive;analysisActive=null;a.resolve({score:a.score??0,best:d.split(/\s+/)[1]||null});return;}}if(d.startsWith('bestmove')){const m=d.split(/\s+/)[1],q=stockfishQueue.shift();stockfishActiveResolve=null;if(q)q(m);}};
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
