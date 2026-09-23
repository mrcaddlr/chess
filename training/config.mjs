export const TRAINING = {
  gamesPerGeneration: Number(process.env.GAMES_PER_GENERATION || 4),
  maxPlies: Number(process.env.MAX_PLIES || 48),
  updatesPerGeneration: Number(process.env.UPDATES_PER_GENERATION || 32),
  learningRate: Number(process.env.LEARNING_RATE || 0.0015),
  evaluationGames: Number(process.env.EVALUATION_GAMES || 10),
  stockfishDepth: Number(process.env.STOCKFISH_DEPTH || 8),
  stockfishRating: 3500,
  checkpoint: 'models/current.json',
  history: 'data/history.json',
  latestEvaluation: 'data/latest-evaluation.json',
  generationDir: 'data/generations'
};
