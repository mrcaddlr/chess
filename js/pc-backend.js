/* Chess Lab PC bridge client */
(function(){
  const TOKEN_KEY='chess-lab-pairing-token';
  const params=new URLSearchParams(location.search);
  const role='controller';
  const apiBase=(location.protocol==='file:' || !['http:','https:'].includes(location.protocol) || !['localhost','127.0.0.1'].includes(location.hostname))?'http://127.0.0.1:8787':location.origin;
  let ws=null,reconnectTimer=null,heartbeatTimer=null,connected=false,nativeCompute=false,apiOnline=false,engineAvailability={};
  const listeners={command:[],status:[],connection:[]};
  function emit(type,data){for(const fn of listeners[type]||[])try{fn(data)}catch(e){console.error(e)}}
  function token(){return localStorage.getItem(TOKEN_KEY)||''}
  async function refreshBackendStatus(){
    try{
      const r=await fetch(apiBase+'/api/health',{cache:'no-store'});
      if(!r.ok)throw new Error('status '+r.status);
      const h=await r.json();
      const sr=await fetch(apiBase+'/api/status',{cache:'no-store'}); if(!sr.ok)throw new Error('status '+sr.status); const s=await sr.json();
      apiOnline=true;nativeCompute=!!s?.nativeCompute;engineAvailability=s?.engines||{};
      document.querySelectorAll('#engineSelect option').forEach(opt=>{
        const a=engineAvailability[opt.value];
        opt.disabled=!!a&&!a.available&&opt.value!=='custom-wasm';
        opt.title=opt.disabled?'not installed on this PC':'';
      });
      const selected=document.getElementById('engineSelect')?.value;
      if(selected&&selected!=='custom-wasm'&&engineAvailability[selected]&&!engineAvailability[selected].available){
        const fallback=Object.entries(engineAvailability).find(([id,v])=>v?.available&&id!=='custom-wasm');
        if(fallback){const sel=document.getElementById('engineSelect');if(sel){sel.value=fallback[0];selectedEngine=fallback[0]}}
      }
      emit('backend-info',s);
      if(role==='controller'){const ready=!!s?.stockfishInfo?.available;stockfishReady=ready;setEngineUi(ready?'Local Stockfish ready':'Local backend connected · Stockfish unavailable',ready);}
      return s;
    }catch(e){apiOnline=false;if(role==='controller'){stockfishReady=false;setEngineUi('Local backend unreachable',false);}emit('backend-info',{apiOnline:false,nativeCompute:false,stockfishInfo:{available:false}});return null;}
  }
  function connect(){
    if(ws&&[0,1].includes(ws.readyState))return;
    try{const u=new URL(apiBase);u.protocol=u.protocol==='https:'?'wss:':'ws:';u.pathname='/ws';u.search='';u.hash='';ws=new WebSocket(u.href)}catch(e){schedule();return}
    ws.onopen=()=>{connected=true;if(role==='controller'){setEngineUi(apiOnline?'Local backend connected':'Connecting to local backend…',apiOnline)}ws.send(JSON.stringify({type:'register',role,token:token()}));clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>{try{if(ws?.readyState===1)ws.send(JSON.stringify({type:'ping',token:token()}))}catch(e){}},10000);emit('connection',{connected:true,role})};
    ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='hello'||m.type==='registered')emit('status',m.state);else if(m.type==='status')emit('status',m.data);else if(m.type==='command')emit('command',m);else if(m.type==='connection')emit('connection',m);else if(m.type==='reload'){location.reload()} }catch(_){}};
    ws.onclose=()=>{connected=false;clearInterval(heartbeatTimer);heartbeatTimer=null;emit('connection',{connected:false,role});schedule()}; ws.onerror=()=>{};
  }
  function schedule(){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,500)}
  function send(type,payload){if(!ws||ws.readyState!==1)return false;ws.send(JSON.stringify({type,token:token(),...payload}));return true}
  refreshBackendStatus();
  setInterval(refreshBackendStatus,3000);
  window.chessLabBackend={
    role,connect,isConnected:()=>connected,nativeCompute:()=>nativeCompute,
    setToken:t=>{localStorage.setItem(TOKEN_KEY,String(t||''));connect()},
    setUrl:u=>{localStorage.setItem('chess-lab-backend-url',String(u||location.origin));location.reload()},
    getUrl:()=>apiBase,
    async getEngineMove(fen,depth=12,allowedMoves=[],engine='sf19-full-single',threads=1){
      const r=await fetch(apiBase+'/api/engine-move',{method:'POST',headers:{'Content-Type':'application/json','X-Chess-Lab-Token':token()},body:JSON.stringify({fen,depth,allowedMoves:allowedMoves.map(m=>m.from+m.to+(m.promotion||'')),engine,threads})});
      if(!r.ok)throw new Error('PC engine request failed: '+r.status);
      const data=await r.json();if(!data.move)throw new Error(data.error||'PC engine returned no move');return data.move;
    },
    async getModel(){const r=await fetch(apiBase+'/api/model',{headers:{'X-Chess-Lab-Token':token()}});if(!r.ok)throw new Error('model download failed: '+r.status);return r.json()},
    async setModel(model){const r=await fetch(apiBase+'/api/model',{method:'POST',headers:{'Content-Type':'application/json','X-Chess-Lab-Token':token()},body:JSON.stringify({model})});if(!r.ok)throw new Error('model upload failed: '+r.status);return r.json()},
    on:(type,fn)=>{(listeners[type]||(listeners[type]=[])).push(fn);return()=>{listeners[type]=listeners[type].filter(x=>x!==fn)}},
    async command(command,data={}){
    if(send('command',{command,data}))return true;
    const routes={'start-training':'/api/training/start','stop-training':'/api/training/stop','pause-training':'/api/training/pause','resume-training':'/api/training/resume','checkpoint-training':'/api/training/checkpoint'};
    const route=routes[command];
    if(!route)return false;
    try{
      const r=await fetch(apiBase+route,{method:'POST',headers:{'Content-Type':'application/json','X-Chess-Lab-Token':token()},body:JSON.stringify(data||{})});
      if(!r.ok){const body=await r.json().catch(()=>({}));emit('command-error',{command,error:body.error||('HTTP '+r.status)});return false;}return true;
    }catch(e){emit('command-error',{command,error:e.message});return false}
  },
    publishStatus:data=>send('status',{data})
  };
  if(!token())fetch(apiBase+'/api/pairing').then(r=>r.ok?r.json():null).then(x=>{if(x?.token){localStorage.setItem(TOKEN_KEY,x.token);connect()}}).catch(()=>connect()); else connect();
})();
