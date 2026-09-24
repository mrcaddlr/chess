/* Chess Lab PC bridge client */
(function(){
  const TOKEN_KEY='chess-lab-pairing-token';
  const params=new URLSearchParams(location.search);
  const role=params.get('controller')==='1'?'controller':'compute';
  const apiBase=localStorage.getItem('chess-lab-backend-url')||location.origin;
  let ws=null,reconnectTimer=null,connected=false,nativeCompute=false;
  const listeners={command:[],status:[],connection:[]};
  function emit(type,data){for(const fn of listeners[type]||[])try{fn(data)}catch(e){console.error(e)}}
  function token(){return localStorage.getItem(TOKEN_KEY)||''}
  function connect(){
    if(ws&&[0,1].includes(ws.readyState))return;
    try{const u=new URL(apiBase);u.protocol=u.protocol==='https:'?'wss:':'ws:';u.pathname='/ws';u.search='';u.hash='';ws=new WebSocket(u.href)}catch(e){schedule();return}
    ws.onopen=()=>{connected=true;ws.send(JSON.stringify({type:'register',role,token:token()}));emit('connection',{connected:true,role})};
    ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='hello'||m.type==='registered')emit('status',m.state);else if(m.type==='status')emit('status',m.data);else if(m.type==='command')emit('command',m);else if(m.type==='connection')emit('connection',m);else if(m.type==='reload'){location.reload()} }catch(_){}};
    ws.onclose=()=>{connected=false;emit('connection',{connected:false,role});schedule()}; ws.onerror=()=>{};
  }
  function schedule(){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,2000)}
  function send(type,payload){if(!ws||ws.readyState!==1)return false;ws.send(JSON.stringify({type,token:token(),...payload}));return true}
  fetch(apiBase+'/api/status').then(r=>r.ok?r.json():null).then(s=>{nativeCompute=!!s?.nativeCompute;emit('backend-info',s)}).catch(()=>{});
  window.chessLabBackend={
    role,connect,isConnected:()=>connected,nativeCompute:()=>nativeCompute,
    setToken:t=>{localStorage.setItem(TOKEN_KEY,String(t||''));connect()},
    setUrl:u=>{localStorage.setItem('chess-lab-backend-url',String(u||location.origin));location.reload()},
    getUrl:()=>apiBase,
    async getEngineMove(fen,depth=12,allowedMoves=[]){
      const r=await fetch(apiBase+'/api/engine-move',{method:'POST',headers:{'Content-Type':'application/json','X-Chess-Lab-Token':token()},body:JSON.stringify({fen,depth,allowedMoves:allowedMoves.map(m=>m.from+m.to+(m.promotion||''))})});
      if(!r.ok)throw new Error('PC engine request failed: '+r.status);
      const data=await r.json();if(!data.move)throw new Error(data.error||'PC engine returned no move');return data.move;
    },
    async getModel(){const r=await fetch(apiBase+'/api/model',{headers:{'X-Chess-Lab-Token':token()}});if(!r.ok)throw new Error('model download failed: '+r.status);return r.json()},
    async setModel(model){const r=await fetch(apiBase+'/api/model',{method:'POST',headers:{'Content-Type':'application/json','X-Chess-Lab-Token':token()},body:JSON.stringify({model})});if(!r.ok)throw new Error('model upload failed: '+r.status);return r.json()},
    on:(type,fn)=>{(listeners[type]||(listeners[type]=[])).push(fn);return()=>{listeners[type]=listeners[type].filter(x=>x!==fn)}},
    command:(command,data={})=>send('command',{command,data}),
    publishStatus:data=>send('status',{data})
  };
  if(!token())fetch(apiBase+'/api/pairing').then(r=>r.ok?r.json():null).then(x=>{if(x?.token){localStorage.setItem(TOKEN_KEY,x.token);connect()}}).catch(()=>connect()); else connect();
})();
