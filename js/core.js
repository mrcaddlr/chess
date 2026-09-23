/* Chess Learning Lab · application state + chess-rule helpers */
const PIECES={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚'};
const FILES='abcdefgh';
const CONFIG={version:'0.7.0',architecture:'ml-policy-value-v1',input:832,hidden1:96,hidden2:64,policy:4352,replayMax:2500,lr:0.0015,valueWeight:.55,policyWeight:1.0,rlBatch:64,trainPlies:160};
let game=new Chess(), flipped=false, selected=null, legalMoves=[], lastMove=null, busy=false, botWhite='learner', botBlack='learner', training=false, trainTimer=null, cancelRequested=false;
const ENGINE_CONFIGS={'sf19-full-single':{label:'Stockfish 19 · Full · Single-threaded',url:'stockfish/stockfish-19-single.js',multi:false},'sf19-full-multi':{label:'Stockfish 19 · Full · Multi-threaded',url:'stockfish/stockfish-19.js',multi:true},'sf19-lite-single':{label:'Stockfish 19 · Lite · Single-threaded',url:'stockfish/stockfish-19-lite-single.js',multi:false},'sf18-full-single':{label:'Stockfish 18 · Full · Single-threaded',url:'stockfish/stockfish-18-single.js',multi:false},'sf18-full-multi':{label:'Stockfish 18 · Full · Multi-threaded',url:'stockfish/stockfish-18.js',multi:true},'sf18-lite-single':{label:'Stockfish 18 · Lite · Single-threaded',url:'stockfish/stockfish-18-lite-single.js',multi:false}};
let selectedEngine='sf19-full-single';
let repetition=new Map(), replay=[], games=0, steps=0, generation=0, evalRecord=null, points=0, repetitionDetections=0, estimatedElo=400, trainingTargetElo=1000, trainingStartedAt=0, trainingSpeed=0;
let brain=null, matchBrainWhite=null, matchBrainBlack=null, stockfishWorker=null, stockfishReady=false, stockfishLoading=false, stockfishQueue=[];
let brainDBPromise=null, matchEpoch=0, matchNonce=0;
// Optional fast-training worker hooks. Keep them defined even when the fast path is unused.
let fastBatchAbort=null, fastWorkers=[];
let moveRecords=[], reviewState=null, reviewRunning=false, lastReviewedEpoch=-1, analysisActive=null, stockfishActiveResolve=null;


function log(msg){const line=new Date().toLocaleTimeString()+'  '+String(msg);const el=document.getElementById('log');if(el)el.textContent=(line+'\\n'+el.textContent).slice(0,24000)}
window.addEventListener('error',e=>log('ERROR: '+(e.message||'unknown error')+' @ '+(e.filename||'inline')+':'+(e.lineno||'?')));
window.addEventListener('unhandledrejection',e=>log('ERROR: unhandled promise rejection: '+(e.reason?.message||String(e.reason||'unknown'))));
function toast(msg){const e=document.getElementById('toast');if(!e)return;e.textContent=msg;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),1800)}
function setStatus(a,b,progress=null){const main=document.getElementById('statusMain'),sub=document.getElementById('statusSub'),bar=document.getElementById('progressBar');if(main)main.textContent=a;if(sub)sub.textContent=b;if(progress!==null&&bar)bar.style.width=Math.max(0,Math.min(100,progress))+'%'}
function positionKey(c){const p=c.fen().split(' ');return [p[0],p[1],p[2],p[3]].join(' ')}
function isCheckmate(c){return typeof c.isCheckmate==='function'?c.isCheckmate():typeof c.in_checkmate==='function'?c.in_checkmate():false}
function isStalemate(c){return typeof c.isStalemate==='function'?c.isStalemate():typeof c.in_stalemate==='function'?c.in_stalemate():false}
function isInsufficientMaterial(c){return typeof c.isInsufficientMaterial==='function'?c.isInsufficientMaterial():typeof c.insufficient_material==='function'?c.insufficient_material():false}
function isGameOver(c){if(isCheckmate(c)||isStalemate(c)||isInsufficientMaterial(c))return true;const f=c.fen().split(' ');return Number(f[4])>=100||repetitionForcedDraw}
function isInCheck(c){return typeof c.isCheck==='function'?c.isCheck():typeof c.in_check==='function'?c.in_check():false}
function recordPosition(c){const k=positionKey(c),n=(repetition.get(k)||0)+1;repetition.set(k,n);return n}
function resetRepetition(){repetition=new Map();repetitionForcedDraw=false;repetitionDetections=0;recordPosition(game)}
let repetitionForcedDraw=false;
function drawReason(c){if(repetitionForcedDraw)return 'repetition';if(isStalemate(c))return 'stalemate';if(isInsufficientMaterial(c))return 'insufficient material';const f=c.fen().split(' ');if(Number(f[4])>=100)return '50-move rule';return null}
function result(c){if(isCheckmate(c))return c.turn()==='w'?-1:1;const d=drawReason(c);return d?0:null}
function terminalText(c){if(isCheckmate(c))return 'checkmate';const d=drawReason(c);if(d)return 'draw · '+d;return null}
function positionStatus(c){if(terminalText(c))return terminalText(c);if(isInCheck(c))return 'check';return null}
function terminalPosition(c,hist){if(isCheckmate(c)||isStalemate(c)||isInsufficientMaterial(c))return true;const f=c.fen().split(' ');if(Number(f[4])>=100)return true;return false}
function moveCreatesRepetitionBreak(c,m,hist){if(!hist)return false;const mv=c.move({from:m.from,to:m.to,promotion:m.promotion});if(!mv)return true;const k=positionKey(c),would=(hist.get(k)||0)+1;c.undo();return would>=4}
function safeRepetitionMove(c,proposed,learnerBrain,hist){const legal=c.moves({verbose:true});if(!legal.length)return {move:null,forcedDraw:false,detected:false};if(proposed&&!moveCreatesRepetitionBreak(c,proposed,hist))return {move:proposed,forcedDraw:false,detected:false};const safe=legal.filter(m=>!moveCreatesRepetitionBreak(c,m,hist));if(!safe.length)return {move:null,forcedDraw:true,detected:true};if(!learnerBrain)return {move:safe[Math.floor(Math.random()*safe.length)],forcedDraw:false,detected:true};const pred=learnerBrain.predict(encode(c),safe.map(actionIndex));let best=safe[0],bs=-Infinity;for(let i=0;i<safe.length;i++){const sc=pred.policy[actionIndex(safe[i])];if(sc>bs){bs=sc;best=safe[i]}}return {move:best,forcedDraw:false,detected:true}}


class RNG{constructor(seed=Date.now()){this.s=seed>>>0}next(){let x=this.s;x^=x<<13;x^=x>>>17;x^=x<<5;this.s=x>>>0;return this.s/4294967296}gauss(){let a=Math.max(1e-9,this.next()),b=this.next();return Math.sqrt(-2*Math.log(a))*Math.cos(Math.PI*2*b)}}

class TinyNet{
  constructor(seed){this.rng=new RNG(seed);this.w1=randArr(CONFIG.hidden1*CONFIG.input,this.rng,Math.sqrt(2/CONFIG.input));this.b1=zeros(CONFIG.hidden1);this.w2=randArr(CONFIG.hidden2*CONFIG.hidden1,this.rng,Math.sqrt(2/CONFIG.hidden1));this.b2=zeros(CONFIG.hidden2);this.wp=randArr(CONFIG.policy*CONFIG.hidden2,this.rng,Math.sqrt(2/CONFIG.hidden2));this.bp=zeros(CONFIG.policy);this.wv=randArr(CONFIG.hidden2,this.rng,Math.sqrt(2/CONFIG.hidden2));this.bv=0}
  trunk(x){const z1=zeros(CONFIG.hidden1),h1=zeros(CONFIG.hidden1),z2=zeros(CONFIG.hidden2),h2=zeros(CONFIG.hidden2);for(let j=0;j<CONFIG.hidden1;j++){let s=this.b1[j],off=j*CONFIG.input;for(let i=0;i<CONFIG.input;i++)s+=this.w1[off+i]*x[i];z1[j]=s;h1[j]=Math.max(0,s)}for(let j=0;j<CONFIG.hidden2;j++){let s=this.b2[j],off=j*CONFIG.hidden1;for(let i=0;i<CONFIG.hidden1;i++)s+=this.w2[off+i]*h1[i];z2[j]=s;h2[j]=Math.max(0,s)}let v=this.bv;for(let i=0;i<CONFIG.hidden2;i++)v+=this.wv[i]*h2[i];return {h1,z1,h2,z2,v:Math.tanh(v)}}
  legalLogits(h2,legal){const logits=new Float32Array(legal.length);for(let k=0;k<legal.length;k++){const a=legal[k],off=a*CONFIG.hidden2;let z=this.bp[a];for(let i=0;i<CONFIG.hidden2;i++)z+=this.wp[off+i]*h2[i];logits[k]=z}return logits}
  predict(x,legal){const o=this.trunk(x),logits=this.legalLogits(o.h2,legal);let max=-Infinity;for(const z of logits)if(z>max)max=z;const vals=new Float32Array(logits.length);let sum=0;for(let i=0;i<logits.length;i++){vals[i]=Math.exp(Math.max(-30,logits[i]-max));sum+=vals[i]}if(sum)for(let i=0;i<vals.length;i++)vals[i]/=sum;const probs=new Float32Array(CONFIG.policy);for(let i=0;i<legal.length;i++)probs[legal[i]]=vals[i];return {policy:probs,value:o.v,cache:o}}
  train(x,target,value,legal,lr=CONFIG.lr){const o=this.trunk(x),logits=this.legalLogits(o.h2,legal),p=new Float32Array(legal.length);let max=-Infinity;for(const z of logits)max=Math.max(max,z);let sum=0;for(let i=0;i<logits.length;i++){p[i]=Math.exp(Math.max(-30,logits[i]-max));sum+=p[i]}for(let i=0;i<p.length;i++)p[i]/=sum||1;
    const d2=zeros(CONFIG.hidden2),d1=zeros(CONFIG.hidden1);let dv=2*(o.v-value)*CONFIG.valueWeight*(1-o.v*o.v);for(let i=0;i<CONFIG.hidden2;i++)d2[i]+=dv*this.wv[i];this.bv-=lr*dv;for(let i=0;i<CONFIG.hidden2;i++)this.wv[i]-=lr*dv*o.h2[i];
    for(let k=0;k<legal.length;k++){const a=legal[k],dl=(p[k]-(target[a]||0))*CONFIG.policyWeight,off=a*CONFIG.hidden2;this.bp[a]-=lr*dl;for(let i=0;i<CONFIG.hidden2;i++){d2[i]+=dl*this.wp[off+i];this.wp[off+i]-=lr*dl*o.h2[i]}}
    for(let i=0;i<CONFIG.hidden2;i++){if(o.z2[i]<=0)d2[i]=0;this.b2[i]-=lr*d2[i];const off=i*CONFIG.hidden1;for(let j=0;j<CONFIG.hidden1;j++){d1[j]+=d2[i]*this.w2[off+j];this.w2[off+j]-=lr*d2[i]*o.h1[j]}}
    for(let j=0;j<CONFIG.hidden1;j++){if(o.z1[j]<=0)d1[j]=0;this.b1[j]-=lr*d1[j];const off=j*CONFIG.input;for(let i=0;i<CONFIG.input;i++)this.w1[off+i]-=lr*d1[j]*x[i]}
    return {loss:Math.abs(o.v-value)}
  }
  trainRL(x,action,reward,legal,lr=CONFIG.lr){
    const o=this.trunk(x),logits=this.legalLogits(o.h2,legal),p=new Float32Array(legal.length);
    let max=-Infinity;for(const z of logits)if(z>max)max=z;let sum=0;
    for(let i=0;i<logits.length;i++){p[i]=Math.exp(Math.max(-30,logits[i]-max));sum+=p[i]}
    for(let i=0;i<p.length;i++)p[i]/=sum||1;
    const d2=zeros(CONFIG.hidden2),d1=zeros(CONFIG.hidden1);
    const r=Math.max(-1,Math.min(1,Number(reward)||0));
    let loss=0;
    for(let k=0;k<legal.length;k++){
      const a=legal[k],target=a===action?1:0;
      const grad=-r*((target?1:0)-p[k]);
      if(target)loss=-r*Math.log(Math.max(1e-8,p[k]));
      const off=a*CONFIG.hidden2;
      this.bp[a]-=lr*grad;
      for(let i=0;i<CONFIG.hidden2;i++){d2[i]+=grad*this.wp[off+i];this.wp[off+i]-=lr*grad*o.h2[i]}
    }
    const targetValue=r;
    const dv=2*(o.v-targetValue)*CONFIG.valueWeight*(1-o.v*o.v);
    for(let i=0;i<CONFIG.hidden2;i++)d2[i]+=dv*this.wv[i];
    this.bv-=lr*dv;for(let i=0;i<CONFIG.hidden2;i++)this.wv[i]-=lr*dv*o.h2[i];
    for(let i=0;i<CONFIG.hidden2;i++){if(o.z2[i]<=0)d2[i]=0;this.b2[i]-=lr*d2[i];const off=i*CONFIG.hidden1;for(let j=0;j<CONFIG.hidden1;j++){d1[j]+=d2[i]*this.w2[off+j];this.w2[off+j]-=lr*d2[i]*o.h1[j]}}
    for(let j=0;j<CONFIG.hidden1;j++){if(o.z1[j]<=0)d1[j]=0;this.b1[j]-=lr*d1[j];const off=j*CONFIG.input;for(let i=0;i<CONFIG.input;i++)this.w1[off+i]-=lr*d1[j]*x[i]}
    return loss+Math.abs(o.v-targetValue);
  }
  toJSON(){const o={version:CONFIG.version,input:CONFIG.input,hidden1:CONFIG.hidden1,hidden2:CONFIG.hidden2,policy:CONFIG.policy,generation,steps,games};for(const k of ['w1','b1','w2','b2','wp','bp','wv'])o[k]=Array.from(this[k]);o.bv=this.bv;return o}
  static fromJSON(o){if(!o||o.input!==undefined&&o.input!==CONFIG.input||o.hidden1!==undefined&&o.hidden1!==CONFIG.hidden1||o.hidden2!==undefined&&o.hidden2!==CONFIG.hidden2||o.policy!==undefined&&o.policy!==CONFIG.policy)throw new Error('incompatible brain architecture');if(!o.wp||o.wp.length!==CONFIG.policy*CONFIG.hidden2)throw new Error('brain uses an older policy encoding; reset or retrain');const n=new TinyNet(1);for(const k of ['w1','b1','w2','b2','wp','bp','wv'])n[k]=Float32Array.from(o[k]);n.bv=o.bv||0;generation=o.generation||0;steps=o.steps||0;games=o.games||0;return n}
}

class Node{constructor(prior=1,move=null){this.prior=prior;this.move=move;this.visits=0;this.valueSum=0;this.children=new Map();this.expanded=false;this.value=0}}