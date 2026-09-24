const ENGINE_CACHE='chess-lab-engines-device-v1';
const ENGINE_SOURCES={
  'stockfish-19-single.wasm':'https://unpkg.com/stockfish@19.0.0/src/stockfish-19-single.wasm',
  'stockfish-19.wasm':'https://unpkg.com/stockfish@19.0.0/src/stockfish-19.wasm',
  'stockfish-19-lite-single.wasm':'https://unpkg.com/stockfish@19.0.0/src/stockfish-19-lite-single.wasm',
  'stockfish-19-lite.wasm':'https://unpkg.com/stockfish@19.0.0/src/stockfish-19-lite.wasm',
  'stockfish-18-single.wasm':'https://unpkg.com/stockfish@18.0.8/src/stockfish-18-single.wasm',
  'stockfish-18.wasm':'https://unpkg.com/stockfish@18.0.8/src/stockfish-18.wasm'
};

self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  const file=url.pathname.split('/').pop();
  const isEngineWasm=Object.prototype.hasOwnProperty.call(ENGINE_SOURCES,file);

  if(isEngineWasm){
    event.respondWith((async()=>{
      const cache=await caches.open(ENGINE_CACHE);
      const cached=await cache.match(event.request);
      if(cached){
        const headers=new Headers(cached.headers);
        headers.set('X-Chess-Lab-Engine-Cache','HIT');
        return new Response(cached.body,{status:cached.status,statusText:cached.statusText,headers});
      }

      const source=ENGINE_SOURCES[file];
      const response=await fetch(source,{mode:'cors',cache:'force-cache'});
      if(!response.ok)throw new Error('upstream engine download failed: HTTP '+response.status);
      const contentType=response.headers.get('content-type')||'application/wasm';
      const headers=new Headers(response.headers);
      headers.set('Content-Type',contentType);
      headers.set('Cache-Control','public, max-age=31536000, immutable');
      headers.set('X-Chess-Lab-Engine-Cache','MISS');
      const stored=new Response(response.body,{status:response.status,statusText:response.statusText,headers});
      await cache.put(event.request,stored.clone());
      return stored;
    })());
    return;
  }

  event.respondWith(fetch(event.request).then(response=>{
    const headers=new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy','same-origin');
    headers.set('Cross-Origin-Embedder-Policy','require-corp');
    headers.set('Cross-Origin-Resource-Policy','same-origin');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }).catch(()=>fetch(event.request)));
});
