/* Match orchestration */
function botForTurn(){return game.turn()==='w'?botWhite:botBlack}

function cloneLearnerForMatch(){return brain?TinyNet.fromJSON(JSON.parse(JSON.stringify(brain.toJSON()))):null}

function learnerBrainForTurn(){return game.turn()==='w'?matchBrainWhite:matchBrainBlack}

function botLabel(kind){return kind==='stockfish'?(ENGINE_CONFIGS[selectedEngine]?.label||'Chess Engine'):kind==='human'?'Human':'Learner'}

function updateMatchBadge(){const type=document.getElementById('matchType').value;const labels={'learner-learner':'learner vs learner','learner-engine':'learner vs chess engine','learner-human':'learner vs human'};document.getElementById('modeBadge').textContent=labels[type]||'learner vs learner';document.getElementById('modeBadge').title='sides are randomized when Play is pressed'}

async function continueMatch(epoch=matchEpoch){if(epoch!==matchEpoch||training||busy)return;if(isGameOver(game)){renderAll();return}const actor=botForTurn();if(actor==='human'){selected=null;legalMoves=[];renderAll();setStatus('your move','playing as '+(game.turn()==='w'?'White':'Black'));return}busy=true;selected=null;legalMoves=[];setStatus('thinking',botLabel(actor)+' is searching');renderBoard();await new Promise(r=>setTimeout(r,30));if(cancelRequested||epoch!==matchEpoch){busy=false;renderAll();return}const safeMoves=repetitionSafeMoves(game,repetition);if(!safeMoves.length){repetitionForcedDraw=true;busy=false;renderAll();setStatus('draw · repetition','all legal moves would create another repetition');finishGameReview(epoch);return}let m=actor==='stockfish'?await stockfishMove(game,12,safeMoves):await learnerMove(game,Number(document.getElementById('sims').value)||32,learnerBrainForTurn(),repetition);if(m&&moveCreatesRepetitionBreak(game,m,repetition)){const safe=safeRepetitionMove(game,m,learnerBrainForTurn(),repetition);m=safe.move;if(safe.forcedDraw){busy=false;renderAll();setStatus('draw · repetition','three repetition detections · points '+points);finishGameReview(epoch);return}}if(!m){const anySafe=repetitionSafeMoves(game,repetition).length;busy=false;if(!anySafe){repetitionForcedDraw=true;renderAll();setStatus('draw · repetition','all legal moves would create another repetition');}else{renderAll();setStatus('engine unavailable',actor==='stockfish'?'Stockfish is not ready':'Learner could not choose a legal move')}return}const fenBefore=game.fen(),mv=game.move({from:m.from,to:m.to,promotion:m.promotion});if(!mv){busy=false;renderAll();setStatus('move failed',botLabel(actor)+' returned an invalid move');return}lastMove={from:mv.from,to:mv.to};recordMove(fenBefore,mv,actor);recordPosition(game);busy=false;renderAll();const t=terminalText(game);if(t){setStatus(t,'game finished');finishGameReview(epoch);return}if(isInCheck(game))setStatus('check',botLabel(botForTurn())+' is in check');await new Promise(r=>setTimeout(r,60));if(cancelRequested||epoch!==matchEpoch){busy=false;renderAll();return}continueMatch(epoch)}

async function simulateOneMove(){if(training||busy||isGameOver(game))return;const actor=botForTurn();if(actor==='human'){setStatus('your move','the current side is set to Human');return}busy=true;selected=null;legalMoves=[];setStatus('thinking',botLabel(actor)+' · simulating one move',20);renderBoard();await new Promise(r=>setTimeout(r,30));if(cancelRequested){busy=false;renderAll();return}const safeMoves=repetitionSafeMoves(game,repetition);if(!safeMoves.length){repetitionForcedDraw=true;busy=false;renderAll();setStatus('draw · repetition','all legal moves would create another repetition');finishGameReview(matchEpoch);return}let m=actor==='stockfish'?await stockfishMove(game,12,safeMoves):await learnerMove(game,Number(document.getElementById('sims').value)||4,learnerBrainForTurn(),repetition);if(m&&moveCreatesRepetitionBreak(game,m,repetition)){repetitionDetections++;points-=2;if(repetitionDetections>=3){repetitionForcedDraw=true;busy=false;renderAll();setStatus('draw · repetition','three repetition detections · points '+points);finishGameReview(matchEpoch);return}const safe=repetitionSafeMoves(game,repetition);if(safe.length){if(actor==='stockfish'){log('Stockfish selected a repetition move despite searchmoves; rejecting it without random replacement')}else m=safeRepetitionMove(game,m,learnerBrainForTurn(),repetition).move}else m=null}if(!m){busy=false;if(!repetitionSafeMoves(game,repetition).length){repetitionForcedDraw=true;renderAll();setStatus('draw · repetition','all legal moves would create another repetition');}else{renderAll();setStatus('engine unavailable',actor==='stockfish'?'Stockfish is not ready':'Learner could not choose a legal move')}return}const fenBefore=game.fen(),mv=game.move({from:m.from,to:m.to,promotion:m.promotion});if(!mv){busy=false;renderAll();setStatus('move failed',botLabel(actor)+' returned an invalid move');return}lastMove={from:mv.from,to:mv.to};recordMove(fenBefore,mv,actor);recordPosition(game);busy=false;renderAll();if(terminalPosition(game,repetition)){renderAll();finishGameReview(matchEpoch)}else setStatus(isInCheck(game)?'check':'ready',isInCheck(game)?botLabel(botForTurn())+' is in check':botLabel(actor)+' made one move',0)}

async function playMatch(){
  if(training||busy)return;
  const epoch=++matchEpoch;
  matchNonce=(Math.random()*0x100000000)>>>0;
  cancelRequested=false;
  const type=document.getElementById('matchType').value;
  if(type==='learner-learner'){
    botWhite='learner'; botBlack='learner';
  }else if(type==='learner-engine'){
    if(Math.random()<0.5){botWhite='learner';botBlack='stockfish';}
    else{botWhite='stockfish';botBlack='learner';}
  }else if(type==='learner-human'){
    if(Math.random()<0.5){botWhite='learner';botBlack='human';}
    else{botWhite='human';botBlack='learner';}
  }
  matchBrainWhite=null; matchBrainBlack=null;
  if(type==='learner-learner'){
    // Both sides receive independent copies of the exact same learner snapshot.
    // No training or weight mutation occurs during the match.
    matchBrainWhite=cloneLearnerForMatch();
    matchBrainBlack=cloneLearnerForMatch();
  }else if(type==='learner-engine'){
    if(botWhite==='learner') matchBrainWhite=cloneLearnerForMatch();
    if(botBlack==='learner') matchBrainBlack=cloneLearnerForMatch();
  }else if(type==='learner-human'){
    if(botWhite==='learner') matchBrainWhite=cloneLearnerForMatch();
    if(botBlack==='learner') matchBrainBlack=cloneLearnerForMatch();
  }
  game=new Chess();selected=null;legalMoves=[];lastMove=null;moveRecords=[];reviewState=null;lastReviewedEpoch=-1;resetRepetition();busy=false;
  renderAll();renderReview();
  renderPlayers();
  setStatus('ready','White: '+botLabel(botWhite)+' · Black: '+botLabel(botBlack)+(type==='learner-learner'?' · identical learner snapshots':'') ,5);
  log('match '+epoch+' started · move-selection seed '+matchNonce);if(type==='learner-engine')log((ENGINE_CONFIGS[selectedEngine]?.label||'Chess engine')+' is the selected local engine; repetition filtering uses UCI searchmoves, never a random replacement');
  await new Promise(r=>setTimeout(r,60));
  if(!isGameOver(game))continueMatch(epoch);
}

function newGame(){
  const nextEpoch=matchEpoch+1;
  matchNonce=(Math.random()*0x100000000)>>>0;
  matchEpoch=nextEpoch;
  cancelRequested=true;
  try{cancelEngine()}catch(e){log('engine cancellation during new game: '+e.message)}
  training=false;
  busy=false;
  cancelRequested=false;
  repetitionForcedDraw=false;
  points=0;repetitionDetections=0;
  game=new Chess();
  selected=null;
  legalMoves=[];
  lastMove=null;
  moveRecords=[];
  reviewState=null;
  reviewRunning=false;
  lastReviewedEpoch=-1;
  matchBrainWhite=null;
  matchBrainBlack=null;
  resetRepetition();
  document.getElementById('promoModal').classList.remove('open');
  renderAll();
  renderReview();
  renderPlayers();
  setStatus('ready','White: '+botLabel(botWhite)+' · Black: '+botLabel(botBlack)+' · press Play to start',0);
  log('new game created · match '+matchEpoch+' · fresh move-selection seed '+matchNonce);
}