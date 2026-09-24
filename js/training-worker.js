/* Local training backend: parallel self-play Web Worker. */
importScripts('chess.js?v=0.31.20','repetition.js?v=0.31.20','core.js?v=0.31.20','learner.js?v=0.31.20');
function wt(c){if(isCheckmate(c))return c.turn()==='w'?-1:1;if(isStalemate(c)||isInsufficientMaterial(c))return 0;const f=c.fen().split(' ');return Number(f[4])>=100?0:null}
async function wm(c,net,hist,state,legal){
  if(!legal.length)return null;
  const result=await mcts(c,Math.max(1,Math.min(32,Number(self.__sims)||8)),net,true);
  if(!result.move)return null;
  const safe=safeRepetitionMove(c,result.move,net,hist,state);
  if(safe.forcedDraw)return null;
  return {move:safe.move,policy:result.policy};
}
self.onmessage=async e=>{const d=e.data||{};if(d.type!=='train')return;try{const net=TinyNet.fromJSON(d.brain),samples=[],games=Math.max(0,Number(d.games)||0),maxPlies=Math.max(40,Number(d.maxPlies)||160);for(let g=0;g<games;g++){const c=new Chess(),hist=newRepetitionHistory(c),state={detections:0,forcedDraw:false},local=[];let p=0;while(!terminalPosition(c)&&!state.forcedDraw&&p<maxPlies){const legal=safeRepetitionMoves(c,hist),choice=await wm(c,net,hist,state,legal);if(!choice)break;const move=choice.move;local.push({x:Array.from(encode(c)),action:actionIndex(move),legal:legal.map(actionIndex),policy:choice.policy,side:c.turn()});if(!c.move({from:move.from,to:move.to,promotion:move.promotion}))break;p++;const k=positionKey(c);hist.set(k,(hist.get(k)||0)+1)}let r=wt(c);if(r===null)r=0;for(const s of local)samples.push({x:s.x,action:s.action,legal:s.legal,policy:s.policy,reward:s.side==='w'?r:-r})}self.postMessage({type:'batch',games,samples})}catch(err){self.postMessage({type:'error',message:err.message||String(err)})}};