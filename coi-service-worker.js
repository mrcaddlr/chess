const ENGINE_CACHE='chess-lab-engines-v1';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  const isEngine=url.pathname.includes('/stockfish/')&&(url.pathname.endsWith('.wasm')||url.pathname.endsWith('.js')||url.pathname.endsWith('.part000')||url.pathname.endsWith('.part001')||url.pathname.endsWith('.part002')||url.pathname.endsWith('.part003')||url.pathname.endsWith('.part004')||url.pathname.endsWith('.part005'));
  event.respondWith((async()=>{
    if(isEngine){
      const cache=await caches.open(ENGINE_CACHE);
      const cached=await cache.match(event.request);
      if(cached)return cached;
      const response=await fetch(event.request);
      if(response.ok)await cache.put(event.request,response.clone());
      return response;
    }
    const response=await fetch(event.request);
    const headers=new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy','same-origin');
    headers.set('Cross-Origin-Embedder-Policy','require-corp');
    headers.set('Cross-Origin-Resource-Policy','same-origin');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  })().catch(()=>fetch(event.request)));
});
