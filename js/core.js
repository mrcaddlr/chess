/* Chess Learning Lab · application state + chess-rule helpers */
const PIECES={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚'};
const FILES='abcdefgh';
const CONFIG={version:'0.11.9',architecture:'residual-policy-value-v3',input:832,hidden1:256,hidden2:256,residualBlocks:3,policy:4352,replayMax:2500,lr:0.0015,valueWeight:.55,policyWeight:1.0,rlBatch:64,trainPlies:160};
let game=new Chess(), flipped=false, selected=null, legalMoves=[], lastMove=null, busy=false, botWhite='learner', botBlack='learner', training=false, trainTimer=null, cancelRequested=false;
const ENGINE_CONFIGS={'sf19-full-single':{label:'Stockfish 19 · Full · Single-threaded',url:'stockfish/stockfish-19-single.js',multi:false},'sf19-full-multi':{label:'Stockfish 19 · Full · Multi-threaded',url:'stockfish/stockfish-19.js',multi:true},'sf19-lite-single':{label:'Stockfish 19 · Lite · Single-threaded',url:'stockfish/stockfish-19-lite-single.js',multi:false},'sf18-full-single':{label:'Stockfish 18 · Full · Single-threaded',url:'stockfish/stockfish-18-single.js',multi:false},'sf18-full-multi':{label:'Stockfish 18 · Full · Multi-threaded',url:'stockfish/stockfish-18.js',multi:true},'sf18-lite-single':{label:'Stockfish 18 · Lite · Single-threaded',url:'stockfish/stockfish-18-lite-single.js',multi:false},'lozza':{label:'Lozza · JavaScript',url:'stockfish/lozza.js',multi:false}};
let selectedEngine='sf19-lite-single';
let replay=[], games=0, steps=0, generation=0, evalRecord=null, points=0, estimatedElo=400, trainingTargetElo=1000, trainingStartedAt=0, trainingSpeed=0;
let brain=null, matchBrainWhite=null, matchBrainBlack=null, stockfishWorker=null, stockfishReady=false, stockfishLoading=false, stockfishQueue=[];
let brainDBPromise=null, matchEpoch=0, matchNonce=0;
// Optional fast-training worker hooks. Keep them defined even when the fast path is unused.
let fastBatchAbort=null, fastWorkers=[];
function stopFastWorkers(){for(const w of fastWorkers){try{w.terminate()}catch(e){}}fastWorkers=[];}
let moveRecords=[], reviewState=null, reviewRunning=false, lastReviewedEpoch=-1, analysisActive=null, stockfishActiveResolve=null;


function log(msg){const line=new Date().toLocaleTimeString()+'  '+String(msg);const el=document.getElementById('log');if(el)el.textContent=(line+'\\n'+el.textContent).slice(0,24000)}
if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('error',e=>log('ERROR: '+(e.message||'unknown error')+' @ '+(e.filename||'inline')+':'+(e.lineno||'?')));
if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('unhandledrejection',e=>log('ERROR: unhandled promise rejection: '+(e.reason?.message||String(e.reason||'unknown'))));
function toast(msg){const e=document.getElementById('toast');if(!e)return;e.textContent=msg;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),1800)}
function setStatus(a,b,progress=null){const main=document.getElementById('statusMain'),sub=document.getElementById('statusSub'),bar=document.getElementById('progressBar');if(main)main.textContent=a;if(sub)sub.textContent=b;if(progress!==null&&bar)bar.style.width=Math.max(0,Math.min(100,progress))+'%'}
function isCheckmate(c){return typeof c.isCheckmate==='function'?c.isCheckmate():typeof c.in_checkmate==='function'?c.in_checkmate():false}
function isStalemate(c){return typeof c.isStalemate==='function'?c.isStalemate():typeof c.in_stalemate==='function'?c.in_stalemate():false}
function isInsufficientMaterial(c){return typeof c.isInsufficientMaterial==='function'?c.isInsufficientMaterial():typeof c.insufficient_material==='function'?c.insufficient_material():false}
function isGameOver(c){if(isCheckmate(c)||isStalemate(c)||isInsufficientMaterial(c))return true;const f=c.fen().split(' ');return Number(f[4])>=100||repetitionForcedDraw}
function isInCheck(c){return typeof c.isCheck==='function'?c.isCheck():typeof c.in_check==='function'?c.in_check():false}
function drawReason(c){if(repetitionForcedDraw)return 'repetition';if(isStalemate(c))return 'stalemate';if(isInsufficientMaterial(c))return 'insufficient material';const f=c.fen().split(' ');if(Number(f[4])>=100)return '50-move rule';return null}
function result(c){if(isCheckmate(c))return c.turn()==='w'?-1:1;const d=drawReason(c);return d?0:null}
function terminalText(c){if(isCheckmate(c))return 'checkmate';const d=drawReason(c);if(d)return 'draw · '+d;return null}
function positionStatus(c){if(terminalText(c))return terminalText(c);if(isInCheck(c))return 'check';return null}
function terminalPosition(c){if(isCheckmate(c)||isStalemate(c)||isInsufficientMaterial(c))return true;const f=c.fen().split(' ');return Number(f[4])>=100||repetitionForcedDraw}

class RNG{constructor(seed=Date.now()){this.s=seed>>>0}next(){let x=this.s;x^=x<<13;x^=x>>>17;x^=x<<5;this.s=x>>>0;return this.s/4294967296}gauss(){let a=Math.max(1e-9,this.next()),b=this.next();return Math.sqrt(-2*Math.log(a))*Math.cos(Math.PI*2*b)}}

class TinyNet{
  constructor(seed){
    this.rng=new RNG(seed);
    this.w1=randArr(CONFIG.hidden1*CONFIG.input,this.rng,Math.sqrt(2/CONFIG.input));
    this.b1=zeros(CONFIG.hidden1);
    this.rw1=Array.from({length:CONFIG.residualBlocks},()=>randArr(CONFIG.hidden2*CONFIG.hidden1,this.rng,Math.sqrt(2/CONFIG.hidden1)));
    this.rb1=Array.from({length:CONFIG.residualBlocks},()=>zeros(CONFIG.hidden2));
    this.rw2=Array.from({length:CONFIG.residualBlocks},()=>randArr(CONFIG.hidden2*CONFIG.hidden2,this.rng,Math.sqrt(2/CONFIG.hidden2)));
    this.rb2=Array.from({length:CONFIG.residualBlocks},()=>zeros(CONFIG.hidden2));
    this.wp=randArr(CONFIG.policy*CONFIG.hidden2,this.rng,Math.sqrt(2/CONFIG.hidden2));
    this.bp=zeros(CONFIG.policy);
    this.wv=randArr(CONFIG.hidden2,this.rng,Math.sqrt(2/CONFIG.hidden2));
    this.bv=0;
  }
  trunk(x){
    const z0=zeros(CONFIG.hidden1),h0=zeros(CONFIG.hidden1);
    for(let j=0;j<CONFIG.hidden1;j++){let s=this.b1[j],off=j*CONFIG.input;for(let i=0;i<CONFIG.input;i++)s+=this.w1[off+i]*x[i];z0[j]=s;h0[j]=Math.max(0,s)}
    let h=h0,blocks=[];
    for(let k=0;k<CONFIG.residualBlocks;k++){
      const zA=zeros(CONFIG.hidden2),a=zeros(CONFIG.hidden2),zB=zeros(CONFIG.hidden2),out=zeros(CONFIG.hidden2);
      for(let j=0;j<CONFIG.hidden2;j++){let s=this.rb1[k][j],off=j*CONFIG.hidden1;for(let i=0;i<CONFIG.hidden1;i++)s+=this.rw1[k][off+i]*h[i];zA[j]=s;a[j]=Math.max(0,s)}
      for(let j=0;j<CONFIG.hidden2;j++){let s=this.rb2[k][j],off=j*CONFIG.hidden2;for(let i=0;i<CONFIG.hidden2;i++)s+=this.rw2[k][off+i]*a[i];zB[j]=s;out[j]=Math.max(0,h[j]+s)}
      blocks.push({input:h,zA,a,zB,out});h=out;
    }
    let v=this.bv;for(let i=0;i<CONFIG.hidden2;i++)v+=this.wv[i]*h[i];
    return {h0,z0,blocks,h2:h,v:Math.tanh(v)};
  }
  legalLogits(h2,legal){
    const logits=new Float32Array(legal.length);
    for(let k=0;k<legal.length;k++){const a=legal[k],off=a*CONFIG.hidden2;let z=this.bp[a];for(let i=0;i<CONFIG.hidden2;i++)z+=this.wp[off+i]*h2[i];logits[k]=z}
    return logits;
  }
  predictLegal(x,legal){
    const o=this.trunk(x),logits=this.legalLogits(o.h2,legal);let max=-Infinity;
    for(let i=0;i<logits.length;i++)if(logits[i]>max)max=logits[i];
    const vals=new Float32Array(logits.length);let sum=0;
    for(let i=0;i<logits.length;i++){vals[i]=Math.exp(Math.max(-30,logits[i]-max));sum+=vals[i]}
    if(sum)for(let i=0;i<vals.length;i++)vals[i]/=sum;
    return {policy:vals,value:o.v,cache:o};
  }
  predict(x,legal){
    const p=this.predictLegal(x,legal),probs=new Float32Array(CONFIG.policy);
    for(let i=0;i<legal.length;i++)probs[legal[i]]=p.policy[i];
    return {policy:probs,value:p.value,cache:p.cache};
  }
  _train(x,target,value,legal,lr,rlAction=null,rlReward=0){
    const o=this.trunk(x),logits=this.legalLogits(o.h2,legal),p=new Float32Array(legal.length);let max=-Infinity;
    for(const z of logits)max=Math.max(max,z);let sum=0;
    for(let i=0;i<logits.length;i++){p[i]=Math.exp(Math.max(-30,logits[i]-max));sum+=p[i]}for(let i=0;i<p.length;i++)p[i]/=sum||1;
    const dh=zeros(CONFIG.hidden2),lossTarget=rlAction===null?value:Math.max(-1,Math.min(1,Number(rlReward)||0));
    const dv=2*(o.v-lossTarget)*CONFIG.valueWeight*(1-o.v*o.v);
    this.bv-=lr*dv;for(let i=0;i<CONFIG.hidden2;i++){dh[i]+=dv*this.wv[i];this.wv[i]-=lr*dv*o.h2[i]}
    let loss=Math.abs(o.v-lossTarget);
    for(let k=0;k<legal.length;k++){
      const a=legal[k],grad=rlAction===null?(p[k]-(target[a]||0))*CONFIG.policyWeight:-Math.max(-1,Math.min(1,Number(rlReward)||0))*((a===rlAction?1:0)-p[k]);
      if(rlAction!==null&&a===rlAction)loss+=-Math.max(-1,Math.min(1,Number(rlReward)||0))*Math.log(Math.max(1e-8,p[k]));
      const off=a*CONFIG.hidden2;this.bp[a]-=lr*grad;
      for(let i=0;i<CONFIG.hidden2;i++){dh[i]+=grad*this.wp[off+i];this.wp[off+i]-=lr*grad*o.h2[i]}
    }
    for(let k=CONFIG.residualBlocks-1;k>=0;k--){
      const bl=o.blocks[k],dIn=zeros(CONFIG.hidden1),dA=zeros(CONFIG.hidden2),dZ=zeros(CONFIG.hidden2);
      for(let j=0;j<CONFIG.hidden2;j++){const d=bl.zB[j]>0?dh[j]:0;dZ[j]=d;dIn[j]+=d}
      for(let j=0;j<CONFIG.hidden2;j++){const off=j*CONFIG.hidden2;for(let i=0;i<CONFIG.hidden2;i++){dA[i]+=dZ[j]*this.rw2[k][off+i];this.rw2[k][off+i]-=lr*dZ[j]*bl.a[i]}this.rb2[k][j]-=lr*dZ[j]}
      for(let i=0;i<CONFIG.hidden2;i++)if(bl.zA[i]<=0)dA[i]=0;
      for(let j=0;j<CONFIG.hidden2;j++){const off=j*CONFIG.hidden1;for(let i=0;i<CONFIG.hidden1;i++){dIn[i]+=dA[j]*this.rw1[k][off+i];this.rw1[k][off+i]-=lr*dA[j]*bl.input[i]}this.rb1[k][j]-=lr*dA[j]}
      for(let i=0;i<CONFIG.hidden1;i++)dh[i]=dIn[i];
    }
    const d0=zeros(CONFIG.hidden1);for(let j=0;j<CONFIG.hidden1;j++){const d=o.z0[j]>0?dh[j]:0;d0[j]=d;this.b1[j]-=lr*d;const off=j*CONFIG.input;for(let i=0;i<CONFIG.input;i++)this.w1[off+i]-=lr*d*x[i]}
    return loss;
  }
  train(x,target,value,legal,lr=CONFIG.lr){return this._train(x,target,value,legal,lr)}
  trainRL(x,action,reward,legal,lr=CONFIG.lr){return this._train(x,null,0,legal,lr,action,reward)}
  toJSON(){
    const o={version:CONFIG.version,input:CONFIG.input,hidden1:CONFIG.hidden1,hidden2:CONFIG.hidden2,residualBlocks:CONFIG.residualBlocks,policy:CONFIG.policy,generation,steps,games};
    for(const k of ['w1','b1','wp','bp','wv'])o[k]=Array.from(this[k]);o.bv=this.bv;
    o.rw1=this.rw1.map(a=>Array.from(a));o.rb1=this.rb1.map(a=>Array.from(a));o.rw2=this.rw2.map(a=>Array.from(a));o.rb2=this.rb2.map(a=>Array.from(a));return o;
  }
  static fromJSON(o){
    if(!o||o.input!==CONFIG.input||o.hidden1!==CONFIG.hidden1||o.hidden2!==CONFIG.hidden2||o.policy!==CONFIG.policy||o.residualBlocks!==CONFIG.residualBlocks)throw new Error('incompatible brain architecture; reset or retrain');
    if(!o.wp||o.wp.length!==CONFIG.policy*CONFIG.hidden2||!o.rw1||o.rw1.length!==CONFIG.residualBlocks)throw new Error('brain uses an older network format; reset or retrain');
    const n=new TinyNet(1);for(const k of ['w1','b1','wp','bp','wv'])n[k]=Float32Array.from(o[k]);n.bv=o.bv||0;
    n.rw1=o.rw1.map(a=>Float32Array.from(a));n.rb1=o.rb1.map(a=>Float32Array.from(a));n.rw2=o.rw2.map(a=>Float32Array.from(a));n.rb2=o.rb2.map(a=>Float32Array.from(a));
    generation=o.generation||0;steps=o.steps||0;games=o.games||0;return n;
  }
}

class Node{constructor(prior=1,move=null){this.prior=prior;this.move=move;this.visits=0;this.valueSum=0;this.children=new Map();this.expanded=false;this.value=0}}