import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function loadCore(){
  const chessSource=fs.readFileSync('js/chess.js','utf8');
  const coreSource=fs.readFileSync('js/core.js','utf8');
  const source=chessSource+'\\n'+coreSource+'\\nthis.__exports={TinyNet,CONFIG};';
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
