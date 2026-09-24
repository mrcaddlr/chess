(function(){
  const screens=['overview','match','training','evaluation','brain','models','settings'];
  const buttons=[...document.querySelectorAll('.nav-item')];
  let index=0;
  function show(name,focus=true){
    const i=screens.indexOf(name); if(i<0)return;
    index=i;
    document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='screen-'+name));
    buttons.forEach(b=>b.classList.toggle('active',b.dataset.screen===name));
    if(focus){const active=buttons[i];if(active)active.focus({preventScroll:true})}
  }
  buttons.forEach((b,i)=>b.addEventListener('click',()=>show(b.dataset.screen,false)));
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,select,textarea,[contenteditable="true"]'))return;
    if(e.key>='1'&&e.key<='7'){show(screens[Number(e.key)-1],false);return}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      const next=(index+(e.key==='ArrowDown'?1:-1)+screens.length)%screens.length;
      e.preventDefault();show(screens[next],true);return;
    }
    if(e.key==='Enter'&&document.activeElement?.classList.contains('nav-item')){
      document.activeElement.click();return;
    }
  });
  window.chessLabNavigation={show};
})();