(function(){
  const screens=['overview','match','training','settings'];
  const buttons=[...document.querySelectorAll('.nav-item')];
  let index=0;
  function redistribute(){
    const home=document.querySelector('#screen-overview .overview-grid');
    const training=document.querySelector('#screen-training .training-bottom');
    const model=document.querySelector('#screen-models .panel');
    const brain=document.querySelector('#screen-brain .panel');
    const evaluation=document.querySelector('#screen-evaluation .panel');
    if(home){if(model&&!model.dataset.moved){model.dataset.moved='1';home.appendChild(model)}if(brain&&!brain.dataset.moved){brain.dataset.moved='1';home.appendChild(brain)}}
    if(training&&evaluation&&!evaluation.dataset.moved){evaluation.dataset.moved='1';training.appendChild(evaluation)}
  }
  function show(name,focus=true){
    const i=screens.indexOf(name);if(i<0)return;
    index=i;document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='screen-'+name));
    buttons.forEach(b=>b.classList.toggle('active',b.dataset.screen===name));
    if(focus){const active=buttons[i];if(active)active.focus({preventScroll:true})}
    window.scrollTo({top:0,behavior:'smooth'});
  }
  buttons.forEach(b=>b.addEventListener('click',()=>show(b.dataset.screen,false)));
  const search=document.getElementById('globalSearch');
  search?.addEventListener('keydown',e=>{
    if(e.key==='Enter'){const q=search.value.trim().toLowerCase();const map={home:'overview',overview:'overview',models:'overview',brain:'overview',play:'match',chess:'match',training:'training',evaluation:'training',history:'training',log:'training',settings:'settings',engines:'settings',backend:'settings'};const hit=map[q]||screens.find(s=>({overview:'home overview models brain',match:'play chess',training:'training evaluation history log learner',settings:'settings engines backend'}[s]||'').includes(q));if(hit)show(hit,false);else if(q)window.chessLabNavigation?.search(q)}
    if(e.key==='Escape'){search.value='';search.blur()}
  });
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,select,textarea,[contenteditable="true"]'))return;
    if(e.key==='/'){e.preventDefault();search?.focus();return}
    if(e.key>='1'&&e.key<='4'){show(screens[Number(e.key)-1],false);return}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      const dir=e.key==='ArrowDown'?1:-1;
      const next=(index+dir+screens.length)%screens.length;
      e.preventDefault();
      show(screens[next],true);
      const active=buttons[next];
      if(active){active.scrollIntoView({block:'nearest',inline:'nearest'});active.animate?.([{transform:'translateY('+(dir>0?'-2px':'2px')+' )',opacity:.72},{transform:'translateY(0)',opacity:1}],{duration:140,easing:'ease-out'});}
      return;
    }
    if(e.key==='Enter'&&document.activeElement?.classList.contains('nav-item'))document.activeElement.click();
  });
  window.chessLabNavigation={show,search:q=>{const nodes=[...document.querySelectorAll('.screen.active .panel')];const n=nodes.find(x=>x.textContent.toLowerCase().includes(q));if(n){n.scrollIntoView({behavior:'smooth',block:'center'});n.animate?.([{outline:'1px solid #9bb7ff'},{outline:'none'}],{duration:900})}}};
  redistribute();show('overview',false);
})();