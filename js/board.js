/* Board renderer + human input */
function renderPlayers(){
  const wn=document.getElementById('whitePlayerName'),bn=document.getElementById('blackPlayerName');
  const wc=document.getElementById('whitePlayerCard'),bc=document.getElementById('blackPlayerCard');
  if(!wn||!bn||!wc||!bc)return;
  wn.textContent=botLabel(botWhite);
  bn.textContent=botLabel(botBlack);
  wc.classList.toggle('active',game.turn()==='w');
  bc.classList.toggle('active',game.turn()==='b');
}

function renderBoard(){const el=document.getElementById('board');el.innerHTML='';const b=game.board();for(let dr=0;dr<8;dr++)for(let df=0;df<8;df++){const r=flipped?7-dr:dr,f=flipped?7-df:df,p=b[r][f],sq=FILES[f]+(8-r),cell=document.createElement('button');cell.className='square '+(((r+f)%2===0)?'light':'dark');cell.dataset.square=sq;cell.setAttribute('aria-label',sq+(p?' '+p.color+' '+p.type:''));if(selected===sq)cell.classList.add('selected');if(lastMove&&(lastMove.from===sq||lastMove.to===sq))cell.classList.add('last');if(p&&p.type==='k'&&p.color===game.turn()&&game.in_check())cell.classList.add('check');if(legalMoves.some(m=>m.to===sq)){const mark=document.createElement('i');mark.className=game.get(sq)?'capture':'legal';cell.appendChild(mark)}if(p){const s=document.createElement('span');s.className='piece '+(p.color==='w'?'white-piece':'black-piece');s.textContent=PIECES[p.color+p.type];cell.appendChild(s)}if(df===0){const c=document.createElement('span');c.className='coord';c.textContent=8-r;cell.appendChild(c)}if(dr===7){const c=document.createElement('span');c.className='coord';c.style.left='auto';c.style.right='4px';c.textContent=FILES[f];cell.appendChild(c)}cell.onclick=()=>onSquare(sq);el.appendChild(cell)}}

function onSquare(sq){if(busy||training||isGameOver(game))return;if((game.turn()==='w'?botWhite:botBlack)!=='human')return;const p=game.get(sq);if(selected){const m=legalMoves.find(x=>x.to===sq);if(m){if(m.promotion)openPromotion(m);else playHuman(m);return}if(p&&p.color===game.turn()){selectSquare(sq);return}selected=null;legalMoves=[];renderBoard();return}if(p&&p.color===game.turn())selectSquare(sq)}

function selectSquare(sq){selected=sq;legalMoves=game.moves({square:sq,verbose:true});renderBoard()}

function openPromotion(m){const modal=document.getElementById('promoModal'),actions=document.getElementById('promoActions');actions.innerHTML='';for(const p of ['q','r','b','n']){const b=document.createElement('button');b.className='btn promo';b.textContent='['+PIECES[game.turn()+p]+']';b.onclick=()=>{modal.classList.remove('open');playHuman({...m,promotion:p})};actions.appendChild(b)}modal.classList.add('open')}

function playHuman(m){const epoch=matchEpoch;if(moveCreatesRepetitionBreak(game,m,repetition)){repetitionDetections++;points-=2;if(repetitionDetections>=3){repetitionForcedDraw=true;renderAll();setStatus('draw · repetition','three repetition detections · points '+points);return}setStatus('choose a different move','repetition detected · choose a different move');return}const fenBefore=game.fen(),mv=game.move({from:m.from,to:m.to,promotion:m.promotion});if(!mv)return;lastMove={from:mv.from,to:mv.to};recordMove(fenBefore,mv,'human');recordPosition(game);selected=null;legalMoves=[];renderAll();if(terminalText(game))finishGameReview(epoch);else continueMatch(epoch)}