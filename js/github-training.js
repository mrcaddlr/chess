/* GitHub Actions benchmark dashboard */
(async function(){
  const root=document.querySelector('.training-view .training-visual-panel');
  if(!root)return;
  const panel=document.createElement('section');
  panel.className='remote-benchmark';
  panel.innerHTML='<div class="remote-benchmark-head"><b>GitHub benchmark</b><span class="badge">loading</span></div><div class="remote-benchmark-grid"><div class="remote-benchmark-stat"><b>—</b><span>generation</span></div><div class="remote-benchmark-stat"><b>—</b><span>estimated Elo</span></div><div class="remote-benchmark-stat"><b>—</b><span>Stockfish wins</span></div><div class="remote-benchmark-stat"><b>—</b><span>record</span></div></div><div class="tiny">GitHub Actions evaluates every completed generation against a fixed Stockfish benchmark.</div><div class="remote-history"></div>';
  root.querySelector('.training-live')?.appendChild(panel);

  const set=(value,index)=>{const e=panel.querySelectorAll('.remote-benchmark-stat b')[index];if(e)e.textContent=value};
  try{
    const bust='?v='+Date.now();
    const latest=await fetch('data/latest-evaluation.json'+bust,{cache:'no-store'});
    if(!latest.ok)throw new Error('no published benchmark yet');
    const record=await latest.json();
    set(record.generation,0);set(record.elo,1);set(record.wins,2);set(record.wins+' / '+record.draws+' / '+record.losses,3);
    panel.querySelector('.badge').textContent='complete';
    const h=panel.querySelector('.remote-history');
    const historyResponse=await fetch('data/history.json'+bust,{cache:'no-store'});
    if(historyResponse.ok){
      const history=await historyResponse.json();
      h.innerHTML='';
      for(const r of history.slice(-12).reverse()){
        const row=document.createElement('div');
        row.className='remote-history-row';
        row.innerHTML='<span>gen '+Number(r.generation||0)+'</span><span>Elo '+Number(r.elo||0)+'</span><span>'+(Number(r.wins||0)+'-'+Number(r.draws||0)+'-'+Number(r.losses||0))+'</span>';
        h.appendChild(row);
      }
    }
  }catch(e){
    panel.querySelector('.badge').textContent='not published';
    panel.querySelector('.tiny').textContent='Run the GitHub Actions training workflow to publish the first benchmark.';
  }
})();
