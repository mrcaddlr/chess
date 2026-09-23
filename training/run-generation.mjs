import fs from 'node:fs';
import { TRAINING } from './config.mjs';
import { Chess } from 'chess.js';
import { loadBrain, playLearnerGame, encode, actionIndex } from './headless.mjs';

fs.mkdirSync('models',{recursive:true});
fs.mkdirSync(TRAINING.generationDir,{recursive:true});
fs.mkdirSync('data',{recursive:true});

const brain=loadBrain(TRAINING.checkpoint);
const previousGeneration=Number(brain.toJSON().generation||0);
const generation=previousGeneration+1;
let replay=[];
let games=0;
let positions=0;
const started=Date.now();

for(let g=0;g<TRAINING.gamesPerGeneration;g++){
  const r=playLearnerGame(brain,{maxPlies:TRAINING.maxPlies,temperature:1});
  replay.push(...r.samples);
  games++;
  positions+=r.samples.length;
}

for(let i=0;i<TRAINING.updatesPerGeneration;i++){
  if(!replay.length)break;
  const s=replay[(Math.random()*replay.length)|0];
  if(!s.legal?.length)continue;
  brain.trainRL(Float32Array.from(s.x),s.action,s.reward,s.legal,TRAINING.learningRate);
}

const data=brain.toJSON();
data.generation=generation;
data.trainingGames=(data.trainingGames||0)+games;
data.trainingPositions=(data.trainingPositions||0)+positions;
data.trainingVersion='github-actions-v1';
data.trainingConfig={
  gamesPerGeneration:TRAINING.gamesPerGeneration,
  maxPlies:TRAINING.maxPlies,
  updatesPerGeneration:TRAINING.updatesPerGeneration,
  learningRate:TRAINING.learningRate
};

const tmp=TRAINING.checkpoint+'.tmp';
fs.writeFileSync(tmp,JSON.stringify(data));
fs.renameSync(tmp,TRAINING.checkpoint);

const generationFile=TRAINING.generationDir+'/generation-'+String(generation).padStart(6,'0')+'.json';
fs.writeFileSync(generationFile,JSON.stringify({
  generation,
  parentGeneration:previousGeneration,
  trainingGames:games,
  trainingPositions:positions,
  trainingTimeMs:Date.now()-started,
  trainingVersion:'github-actions-v1',
  status:'trained-awaiting-stockfish'
}));

console.log(JSON.stringify({generation,games,positions,trainingTimeMs:Date.now()-started}));
