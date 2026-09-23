export function scoreFromResults(wins,draws,losses){
  const games=wins+draws+losses;
  return games ? (wins+0.5*draws)/games : 0.5;
}

export function performanceElo(score,opponent=3500){
  const p=Math.max(0.01,Math.min(0.99,score));
  return Math.round(opponent+400*Math.log10(p/(1-p)));
}
