/* Neural learner · policy/value network + search
   The network begins with random weights. Chess rules come from chess.js. */
function zeros(n){return new Float32Array(n)}

function randArr(n,rng,scale){const a=new Float32Array(n);for(let i=0;i<n;i++)a[i]=rng.gauss()*scale;return a}

function encode(c){const x=new Float32Array(CONFIG.input);const b=c.board();for(let r=0;r<8;r++)for(let f=0;f<8;f++){const p=b[r][f];if(p){const pi='pnbrqk'.indexOf(p.type),base=(p.color==='w'?0:6)+pi;x[base*64+r*64+f]=1}}let o=12*64;x[o++]=c.turn()==='w'?1:0;const cast=c.fen().split(' ')[2];x[o++]=cast.includes('K')?1:0;x[o++]=cast.includes('Q')?1:0;x[o++]=cast.includes('k')?1:0;x[o++]=cast.includes('q')?1:0;const ep=c.fen().split(' ')[3];if(ep!=='-'){const file=FILES.indexOf(ep[0]),rank=Number(ep[1])-1;if(file>=0&&rank>=0)x[o+rank*8+file]=1}return x}

function actionIndex(m){const a=(Number(m.from[1])-1)*8+(m.from.charCodeAt(0)-97),b=(Number(m.to[1])-1)*8+(m.to.charCodeAt(0)-97);return m.promotion?4096+a*4+({q:0,r:1,b:2,n:3}[m.promotion]):a*64+b}

function legalActions(c){return c.moves({verbose:true}).map(actionIndex)}

function moveFromAction(c,idx){const moves=c.moves({verbose:true});return moves.find(m=>actionIndex(m)===idx)||null}

function softmaxLegal(c,temperature=1,learnerBrain=brain){const legal=c.moves({verbose:true});if(!legal.length)return null;if(!learnerBrain)return legal[Math.floor(Math.random()*legal.length)];const actions=legal.map(actionIndex),pred=learnerBrain.predictLegal(encode(c),actions);if(temperature<=0){let best=legal[0],bs=-Infinity;for(let i=0;i<legal.length;i++){const s=pred.policy[i];if(s>bs){bs=s;best=legal[i]}}return best}const vals=legal.map(m=>Math.pow(Math.max(1e-8,pred.policy[actionIndex(m)]),1/temperature));let z=vals.reduce((a,b)=>a+b,0),r=Math.random()*z;for(let i=0;i<legal.length;i++){r-=vals[i];if(r<=0)return legal[i]}return legal.at(-1)}

function terminalValue(c){if(isCheckmate(c))return c.turn()==='w'?-1:1;if(isStalemate(c)||isInsufficientMaterial(c))return 0;const f=c.fen().split(' ');if(Number(f[4])>=100)return 0;return null}

function expandNode(node,c,learnerBrain=brain){const moves=c.moves({verbose:true});if(!moves.length){node.expanded=true;node.value=terminalValue(c)??0;return node.value}const actions=moves.map(actionIndex),pred=learnerBrain.predictLegal(encode(c),actions);for(let i=0;i<moves.length;i++){const m=moves[i],a=actions[i];node.children.set(a,new Node(pred.policy[i],m))}node.expanded=true;node.value=pred.value;return pred.value}

// Search cache: reuse the subtree that survived the previous move and memoize positions.
// chess.js remains the rules authority; the cache only avoids repeating network expansion work.
let mctsRoot=null,mctsRootKey=null,mctsPendingKey=null;
const mctsTranspositions=new Map();
const MCTS_CACHE_MAX=4096;
function searchKey(c){return c.fen();}
function pruneMctsCache(){while(mctsTranspositions.size>MCTS_CACHE_MAX){const first=mctsTranspositions.keys().next().value;mctsTranspositions.delete(first)}}
function retainMctsChild(c,move){
  if(!mctsRoot||!move)return;
  const child=mctsRoot.children.get(actionIndex(move));
  if(child){const next=new Chess(c.fen());if(next.move({from:move.from,to:move.to,promotion:move.promotion})){mctsRoot=child;mctsRoot.move=null;mctsPendingKey=next.fen();mctsRootKey=null;return}}
  mctsRoot=null;mctsRootKey=null;mctsPendingKey=null;
}
function resetMctsTree(){mctsRoot=null;mctsRootKey=null;mctsPendingKey=null;mctsTranspositions.clear()}
function cachedRootFor(c){
  const key=searchKey(c);
  if(mctsRoot&&(mctsRootKey===key||mctsPendingKey===key)){mctsRootKey=key;mctsPendingKey=null;mctsTranspositions.set(key,mctsRoot);return mctsRoot;}
  const cached=mctsTranspositions.get(key);
  if(cached){mctsRoot=cached;mctsRootKey=key;return cached}
  const root=new Node(1);mctsRoot=root;mctsRootKey=key;mctsTranspositions.set(key,root);pruneMctsCache();return root;
}
async function mcts(c,sims,learnerBrain=brain,detailed=false){
  if(!learnerBrain){
    const ms=c.moves({verbose:true}),move=ms.length?ms[Math.floor(Math.random()*ms.length)]:null;
    return detailed?{move,policy:move?[{a:actionIndex(move),p:1}]:[],legal:ms.map(actionIndex)}:move;
  }
  const root=cachedRootFor(c);
  const count=Math.max(1,Math.min(64,Number(sims)||1));
  for(let sim=0;sim<count;sim++){
    const state=new Chess(c.fen());let node=root,path=[],value=null;
    while(true){
      value=terminalValue(state);
      if(value!==null)break;
      if(!node.expanded){value=expandNode(node,state,learnerBrain);break}
      let best=null,bestScore=-Infinity;
      for(const ch of node.children.values()){
        const q=ch.visits?ch.valueSum/ch.visits:0;
        const u=CONFIG.exploration*ch.prior*Math.sqrt(Math.max(1,node.visits))/(1+ch.visits);
        const score=q+u;
        if(score>bestScore){bestScore=score;best=ch}
      }
      if(!best)break;
      if(!state.move({from:best.move.from,to:best.move.to,promotion:best.move.promotion}))break;
      path.push(best);node=best;
    }
    if(value===null)value=0;
    for(let i=path.length-1;i>=0;i--){path[i].visits++;path[i].valueSum+=value;value=-value}
    root.visits++;root.valueSum+=value;
    if((sim&7)===7)await new Promise(r=>setTimeout(r,0));
  }
  let best=null,bestN=-1,bestTie=-Infinity;
  for(const ch of root.children.values()){
    const tie=Math.random();
    if(ch.visits>bestN||(ch.visits===bestN&&tie>bestTie)){bestN=ch.visits;bestTie=tie;best=ch.move}
  }
  if(!best)best=softmaxLegal(c,0,learnerBrain);
  if(!detailed)return best;
  const total=[...root.children.values()].reduce((a,ch)=>a+ch.visits,0)||1;
  const policy=[...root.children.values()].filter(ch=>ch.visits>0).map(ch=>({a:actionIndex(ch.move),p:ch.visits/total}));
  return {move:best,policy,legal:[...root.children.keys()],nodes:root.visits};
}
async function learnerMove(c,sims,learnerBrain=brain,hist=repetition){const legal=c.moves({verbose:true});if(!legal.length)return null;try{let m;if(!learnerBrain)m=legal[Math.floor(Math.random()*legal.length)];else{const safeSims=Math.max(1,Math.min(16,Number(sims)||4));m=await mcts(c,safeSims,learnerBrain)}const safe=safeRepetitionMove(c,m,learnerBrain,hist);if(safe.forcedDraw)return null;retainMctsChild(c,safe.move);return safe.move}catch(e){log('Learner search error: '+e.message);const safe=safeRepetitionMove(c,null,learnerBrain,hist);return safe.move}}

function randomMove(c){const ms=c.moves({verbose:true});return ms.length?ms[Math.floor(Math.random()*ms.length)]:null}