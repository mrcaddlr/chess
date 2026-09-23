/* IndexedDB persistence + import/export */
function openBrainDB(){
  if(brainDBPromise)return brainDBPromise;
  brainDBPromise=new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return}
    const req=indexedDB.open('chess-learning-lab',1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('state'))db.createObjectStore('state')};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
  });return brainDBPromise;
}

let brainSavePromise=Promise.resolve();
async function saveBrain(show=true){
  brainSavePromise=brainSavePromise.then(async()=>{
  try{
    const db=await openBrainDB();
    const state={version:CONFIG.version,architecture:CONFIG.architecture,brain:brain.toJSON(),replay:replay.slice(-CONFIG.replayMax),evaluationHistory:evaluationHistory.slice(-100),bestEvalScore,championGeneration};
    await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(state,'learner');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'))});
    try{localStorage.removeItem('chess-learning-brain');localStorage.removeItem('chess-learning-replay')}catch(e){}
    if(show){toast('brain saved');log('neural network saved to IndexedDB')}markBrainSaved()
  }catch(e){log('save failed: '+e.message)}
  });
  return brainSavePromise;
}

async function loadBrain(){
  try{
    const db=await openBrainDB();
    const state=await new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly');const q=tx.objectStore('state').get('learner');q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error)});
    if(state?.brain){brain=TinyNet.fromJSON(state.brain);replay=Array.isArray(state.replay)?state.replay.slice(-CONFIG.replayMax).map(s=>({...s,x:s?.x instanceof Float32Array?s.x:Float32Array.from(s?.x||[])})):[];evaluationHistory=Array.isArray(state.evaluationHistory)?state.evaluationHistory.slice(-100):[];bestEvalScore=Number(state.bestEvalScore??-1);championGeneration=Number(state.championGeneration||0);renderStats();toast('neural network loaded');log('neural network loaded from IndexedDB');return}
    const raw=localStorage.getItem('chess-learning-brain');
    if(raw){brain=TinyNet.fromJSON(JSON.parse(raw));const rp=localStorage.getItem('chess-learning-replay');if(rp)replay=JSON.parse(rp).slice(-CONFIG.replayMax).map(s=>({...s,x:Float32Array.from(s.x||[])}));await saveBrain(false);toast('brain migrated to IndexedDB');log('migrated old localStorage brain to IndexedDB');return}
    toast('no saved brain');
  }catch(e){brain=new TinyNet(Date.now());replay=[];toast('fresh neural network');log('saved brain could not be loaded: '+e.message+' · started fresh')}
}

function markBrainDirty(){
  const el=document.getElementById('brainState');
  if(el)el.textContent='autosave pending';
}

function markBrainSaved(){
  const el=document.getElementById('brainState');
  if(el)el.textContent='saved locally';
}

function resetBrain(){if(!confirm('reset the learner to random neural-network weights?'))return;brain=new TinyNet(Date.now());generation=0;steps=0;games=0;replay=[];evaluationHistory=[];bestEvalScore=-1;championGeneration=0;try{localStorage.removeItem('chess-learning-brain');localStorage.removeItem('chess-learning-replay')}catch(e){};openBrainDB().then(db=>new Promise(resolve=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').delete('learner');tx.oncomplete=resolve})).catch(()=>{});renderStats();toast('new random neural network');log('learner reset: random weights')}

function exportBrain(){const exportReplay=replay.slice(-CONFIG.replayMax).map(s=>({...s,x:Array.from(s.x||[])}));const blob=new Blob([JSON.stringify({app:'Chess Learning Lab',version:CONFIG.version,architecture:CONFIG.architecture,brain:brain.toJSON(),replay:exportReplay,evaluationHistory, bestEvalScore, championGeneration})],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chess-learning-brain-gen-'+generation+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

function importBrain(){document.getElementById('fileInput').click()}