import fs from 'node:fs';
import vm from 'node:vm';
import { Chess } from 'chess.js';

const sandbox = {
  console,
  Chess,
  performance: { now: () => Date.now() },
  document: { getElementById: () => null },
  window: { addEventListener() {} },
  navigator: { hardwareConcurrency: 2 },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Math, Date, Float32Array, Array, Object, Number, String, JSON, Promise
};
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);

for (const file of ['js/core.js', 'js/learner.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
vm.runInContext('globalThis.__C={TinyNet,RNG,CONFIG,encode,actionIndex};', context);

export const { TinyNet, RNG, CONFIG, encode, actionIndex } = context.__C;

export function loadBrain(file) {
  if (!fs.existsSync(file)) return new TinyNet(Date.now());
  return TinyNet.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function choosePolicyMove(c, brain, temperature=1) {
  const moves=c.moves({verbose:true});
  if (!moves.length) return null;
  const actions=moves.map(actionIndex);
  const pred=brain.predictLegal(encode(c), actions);
  if (temperature <= 0) {
    let best=0;
    for(let i=1;i<pred.policy.length;i++) if(pred.policy[i]>pred.policy[best]) best=i;
    return moves[best];
  }
  const weights=moves.map((_,i)=>Math.pow(Math.max(1e-8,pred.policy[i]),1/temperature));
  const total=weights.reduce((a,b)=>a+b,0)||1;
  let r=Math.random()*total;
  for(let i=0;i<moves.length;i++){r-=weights[i];if(r<=0)return moves[i];}
  return moves.at(-1);
}

export function terminalValue(c) {
  if(c.isCheckmate()) return c.turn()==='w' ? -1 : 1;
  if(c.isStalemate()||c.isInsufficientMaterial()||Number(c.fen().split(' ')[4])>=100) return 0;
  return null;
}

export function playLearnerGame(brain,{maxPlies=48,temperature=1}={}) {
  const c=new Chess(),samples=[];
  for(let ply=0;ply<maxPlies&&!c.isGameOver();ply++){
    const legal=c.moves({verbose:true});
    if(!legal.length)break;
    const move=choosePolicyMove(c,brain,temperature);
    if(!move)break;
    const sample={x:Array.from(encode(c)),action:actionIndex(move),legal:legal.map(actionIndex),side:c.turn()};
    if(!c.move({from:move.from,to:move.to,promotion:move.promotion}))break;
    samples.push(sample);
  }
  let result=terminalValue(c);
  if(result===null)result=0;
  for(const s of samples)s.reward=s.side==='w'?result:-result;
  return {samples,result,moves:c.history().length};
}
