/* UCI engine bridge · Stockfish / custom WASM */
function engineDisplayLabel(){
  if(selectedEngine==='custom-wasm')return 'Custom UCI WASM engine';
  return ENGINE_CONFIGS[selectedEngine]?.label||'Chess Engine';
}
function setEngineUi(label,ok){const pill=document.getElementById('enginePill'),dot=document.getElementById('onlineDot');if(pill)pill.textContent=label;if(dot)dot.style.background=ok?'var(--mint)':'var(--red)';}
let stockfishBlobUrls=[];
function waitForStockfish(timeout=125000){return new Promise(resolve=>{if(stockfishReady){resolve(true);return}const started=Date.now();const timer=setInterval(()=>{if(stockfishReady||Date.now()-started>=timeout){clearInterval(timer);resolve(stockfishReady)}},100)})}
async function buildBundledEngineWorker(engineUrl){
  const manifestUrl=new URL('stockfish/engine-manifest.json',document.baseURI).href;
  let manifest=null;
  try{const r=await fetch(manifestUrl,{cache:'reload'});if(r.ok)manifest=await r.json();}catch(err){log('engine manifest fetch failed: '+err.message)}
  const jsName=engineUrl.split('/').pop(),wasmName=jsName.replace(/\.js$/i,'.wasm'),parts=manifest?.[wasmName];
  if(!Array.isArray(parts)||!parts.length)return new Worker(engineUrl);
  log('assembling '+wasmName+' from '+parts.length+' Pages chunks');
  const responses=await Promise.all(parts.map(p=>fetch(new URL('stockfish/'+p,document.baseURI).href,{cache:'reload'})));
  for(let i=0;i<responses.length;i++)if(!responses[i].ok)throw new Error('Stockfish chunk '+parts[i]+' returned HTTP '+responses[i].status);
  const buffers=await Promise.all(responses.map(r=>r.arrayBuffer()));
  const total=buffers.reduce((n,a)=>n+a.byteLength,0);
  if(total<1024*1024)throw new Error('assembled '+wasmName+' is only '+total+' bytes; Pages is serving an incomplete WASM bundle');
  const wasm=new Uint8Array(total);let offset=0;
  for(const part of buffers){wasm.set(new Uint8Array(part),offset);offset+=part.byteLength}
  try{await WebAssembly.compile(wasm)}catch(err){throw new Error('assembled '+wasmName+' failed WebAssembly validation: '+(err.message||err))}
  const wasmUrl=URL.createObjectURL(new Blob([wasm],{type:'application/wasm'}));
  const jsResponse=await fetch(engineUrl,{cache:'reload'});if(!jsResponse.ok)throw new Error('engine JavaScript file returned HTTP '+jsResponse.status);
  const source=await jsResponse.text();
  const bootstrap='var Module=self.Module=self.Module||{};Module.locateFile=function(){return '+JSON.stringify(wasmUrl)+';};\n'+source;
  const workerUrl=URL.createObjectURL(new Blob([bootstrap],{type:'text/javascript'}));
  stockfishBlobUrls.push(wasmUrl,workerUrl);
  return new Worker(workerUrl);
}
async function createStockfish(force=false){
  if((stockfishWorker||stockfishLoading)&&!force)return;
  const cfg=ENGINE_CONFIGS[selectedEngine]||null,previousWorker=stockfishWorker,previousReady=stockfishReady;
  const engineUrl=selectedEngine==='custom-wasm'?document.getElementById('customEngineUrl')?.value.trim():cfg?.url?new URL(cfg.url,document.baseURI).href:'';
  if(!engineUrl){stockfishLoading=false;setEngineUi(previousReady?'previous engine ready':'Engine unavailable',previousReady);log(previousReady?'engine selection has no valid URL; keeping the working engine':'engine URL is missing');return;}
  if(cfg?.multi&&(!window.crossOriginIsolated||typeof SharedArrayBuffer==='undefined')){stockfishLoading=false;setEngineUi(previousReady?'previous engine ready':'Multi-threaded engine unavailable',previousReady);log(cfg.label+' requires cross-origin isolation (COOP/COEP); keeping the current engine');return;}
  const requestedLabel=cfg?.label||'Custom UCI WASM engine';log('loading '+requestedLabel+' · '+engineUrl);stockfishLoading=true;let worker=null,settled=false;
  const fail=(reason)=>{if(settled)return;settled=true;stockfishLoading=false;try{worker?.terminate()}catch(e){}if(stockfishWorker===worker)stockfishWorker=null;if(previousWorker&&previousReady&&previousWorker!==worker){stockfishWorker=previousWorker;stockfishReady=true;setEngineUi('previous engine ready',true);log(requestedLabel+' failed; kept the previously working engine');}else{stockfishReady=false;setEngineUi(requestedLabel+' failed',false);}log('Engine worker error: '+reason);};
  try{
    worker=await buildBundledEngineWorker(engineUrl);if(settled){try{worker.terminate()}catch(e){}return;}stockfishWorker=worker;stockfishReady=false;
    worker.onmessage=e=>{const d=typeof e.data==='string'?e.data:'';if(!d)return;if(d.includes('uciok')){settled=true;stockfishReady=true;stockfishLoading=false;setEngineUi(requestedLabel+' ready',true);log(requestedLabel+' ready · local GitHub Pages worker');try{if(cfg?.multi)worker.postMessage('setoption name Threads value '+Math.max(1,navigator.hardwareConcurrency||2));worker.postMessage('isready');}catch(err){log('engine initialization command failed: '+err.message)}return;}if(d.includes('readyok'))stockfishReady=true;if(analysisActive){if(d.startsWith('info ')){const m=d.match(/score\s+(cp|mate)\s+(-?\d+)/);if(m){const n=Number(m[2]);analysisActive.score=m[1]==='mate'?(n>0?100000:-100000):n;}}if(d.startsWith('bestmove')){const a=analysisActive;analysisActive=null;a.resolve({score:a.score??0,best:d.split(/\s+/)[1]||null});return;}}if(d.startsWith('bestmove')){const m=d.split(/\s+/)[1],q=stockfishQueue.shift();stockfishActiveResolve=null;if(q)q(m);}};
    worker.onerror=e=>fail('message='+(e.message||'unknown')+' filename='+(e.filename||engineUrl)+' line='+(e.lineno||'?')+' col='+(e.colno||'?'));worker.onmessageerror=()=>fail('messageerror while communicating with the engine worker');worker.postMessage('uci');setTimeout(()=>{if(!settled&&stockfishWorker===worker)fail('timeout waiting for uciok after 120 seconds · engine file may not be deployed')},120000);
  }catch(e){fail('constructor: '+e.message)}
}
function stockfishAnalyze(fen,depth=7){return new Promise(resolve=>{if(!stockfishReady||!stockfishWorker){resolve(null);return}analysisActive={resolve,score:null};stockfishWorker.postMessage('position fen '+fen);stockfishWorker.postMessage('go depth '+Math.max(4,Math.min(12,depth)));});}
function stockfishSetStrength(full=true){if(!stockfishReady||!stockfishWorker)return;try{stockfishWorker.postMessage('setoption name UCI_LimitStrength value '+(!full));if(full)stockfishWorker.postMessage('setoption name UCI_Elo value 3000');stockfishWorker.postMessage('isready')}catch(e){log('engine strength reset failed: '+e.message)}}
function stockfishMove(c,depth=12,allowedMoves=null){return new Promise(resolve=>{if(!stockfishReady||!stockfishWorker){log('Stockfish is not ready');resolve(null);return}const legal=c.moves({verbose:true}),allowed=Array.isArray(allowedMoves)?allowedMoves:legal,allowedUci=allowed.map(x=>x.from+x.to+(x.promotion||''));if(!allowedUci.length){resolve(null);return}const done=uci=>{const m=legal.find(x=>x.from+x.to+(x.promotion||'')===uci);resolve(m||null)};stockfishQueue.push(done);stockfishActiveResolve=()=>{const i=stockfishQueue.indexOf(done);if(i>=0)stockfishQueue.splice(i,1);resolve(null)};stockfishWorker.postMessage('ucinewgame');stockfishWorker.postMessage('position fen '+c.fen());stockfishWorker.postMessage('go depth '+depth+' searchmoves '+allowedUci.join(' '))})}
function cancelEngine(){cancelRequested=true;if(fastBatchAbort){const abort=fastBatchAbort;fastBatchAbort=null;abort()}else stopFastWorkers();if(stockfishWorker&&stockfishReady){try{stockfishWorker.postMessage('stop')}catch(e){}}if(stockfishActiveResolve){const r=stockfishActiveResolve;stockfishActiveResolve=null;r()}if(analysisActive){const a=analysisActive;analysisActive=null;a.resolve(null)}stockfishQueue.length=0;busy=false;}
