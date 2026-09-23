import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function loadCore(){
  const source=fs.readFileSync('js/core.js','utf8')+'\nthis.__exports={TinyNet,CONFIG};';
  const context=vm.createContext({
    console:{log(){},warn(){},error(){}},
    window:{addEventListener(){}},
    document:{getElementById(){return null}},
    navigator:{},
    performance:{now:()=>0},
    setTimeout,
    clearTimeout,
    Float32Array,
    Math,
    Date
  });
  vm.runInContext(source,context,{filename:'js/core.js'});
  return context.__exports;
}

const {TinyNet,CONFIG}=loadCore();
assert.equal(CONFIG.input,837);
assert.equal(CONFIG.hidden1,384);
assert.equal(CONFIG.hidden2,384);
assert.equal(CONFIG.residualBlocks,8);
assert.equal(CONFIG.policy,4352);

const net=new TinyNet(12345);
const x=new Float32Array(CONFIG.input);
x[0]=1;x[100]=1;
const legal=[0,1,64,4096];
const before=net.predictLegal(x,legal);
assert.equal(before.policy.length,legal.length);
assert.ok(before.policy.every(Number.isFinite));
assert.ok(Number.isFinite(before.value));
const loss=net.trainPolicyValue(x,[{a:0,p:.7},{a:1,p:.2},{a:64,p:.1}],.25,legal,.0015);
assert.ok(Number.isFinite(loss));
const after=net.predictLegal(x,legal);
assert.ok(after.policy.every(Number.isFinite));
assert.ok(Number.isFinite(after.value));
assert.ok(Math.abs(after.policy.reduce((a,b)=>a+b,0)-1)<1e-4);
const json=net.toJSON();
const restored=TinyNet.fromJSON(json);
const round=restored.predictLegal(x,legal);
for(let i=0;i<legal.length;i++)assert.ok(Math.abs(round.policy[i]-after.policy[i])<1e-6);
assert.ok(Math.abs(round.value-after.value)<1e-6);

const training=fs.readFileSync('js/training.js','utf8');
assert.ok(!training.includes('Math.min(maxPlies,140)'),'engine training must honor configured ply limit');
assert.ok(training.includes('choice.policy'),'MCTS policy targets must reach replay');
assert.ok(training.includes("mode==='target'?batch"),'target mode must use configured batch size');

for(const file of ['js/core.js','js/learner.js','js/training.js','js/engine.js','js/review.js','js/board.js','js/match.js','js/ui.js','js/storage.js','js/app.js']){
  const text=fs.readFileSync(file,'utf8');
  assert.ok(!text.includes('\\n'),`${file} contains a literal escaped newline sequence`);
}

console.log('neural/training checks passed');
