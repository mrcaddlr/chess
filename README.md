# Chess Learning Lab

A browser-first chess learning experiment built with HTML, CSS, and JavaScript.

The learner starts with randomly initialized neural-network weights and improves through self-play. Everything important runs locally in the browser, so the project does not require a server, database, paid hosting, or a credit/debit card.

## What it does

- Plays learner vs learner matches.
- Plays against a local Stockfish WASM engine.
- Lets a human play against the learner.
- Starts with random weights rather than a chess opening book or hand-written strategy.
- Stores experience in an in-memory replay buffer.
- Trains a policy/value network with reinforcement-learning updates.
- Uses Web Workers for parallel self-play when the browser supports them.
- Saves the learner locally with IndexedDB.
- Exports and imports learner checkpoints as JSON.
- Tracks generations, games, training steps, and an estimated Elo.
- Can evaluate the learner against Stockfish after a training generation.
- Works as a static GitHub Pages site and can also be opened from another static web host.

## Browser-only training

Training is intentionally local.

There is no GitHub Actions training backend. GitHub Pages is only used to serve the application.

This is especially useful on Android: the phone does the computation directly in the browser and the learner remains available after refreshing because its checkpoint is stored locally.

For long training sessions, keep the page open and avoid putting the browser into battery-saving/background mode.

## Learning loop

A training generation follows this general flow:

    learner
       |
       v
    self-play games
       |
       v
    replay memory
       |
       v
    gradient updates
       |
       v
    new learner generation
       |
       v
    optional Stockfish benchmark
       |
       v
    estimated Elo + statistics

Stockfish evaluation is measurement, not training data. The benchmark is kept separate from the learner's self-play experience.

## Training controls

### Training mode

**Train for a set number of games**

Runs the requested number of local training games.

**Train until target Elo estimate**

Runs training while an engine-based Elo estimate remains below the selected target.

### Training source

**Parallel self-play only**

The normal learning mode. Two copies of the learner generate games and those positions are used for learning.

**Train against Stockfish**

Uses the local engine as a curriculum opponent.

**Mixed**

Combines self-play and Stockfish curriculum.

## Model

The current learner uses a policy/value neural network with:

- 832 input features
- 384-unit first hidden layer
- residual blocks
- policy output for legal chess actions
- scalar value output
- gradient-based reinforcement learning
- Monte Carlo Tree Search for move selection

The exact architecture is versioned in the source so checkpoints can be rejected when they are incompatible.

## Persistence

The browser stores:

- neural-network weights
- generation number
- training counters
- replay memory

in IndexedDB.

Use **Export JSON** before clearing browser data or moving to another device.

## Stockfish

Stockfish runs locally through the bundled browser engine worker.

The engine is not a cloud service. A compatible browser needs to support Web Workers and WebAssembly for the bundled engine.

For a benchmark, use the same Stockfish version/settings across generations if you want the Elo history to remain comparable.

## Android

The app is designed to work on mobile browsers.

Recommended approach:

1. Open the GitHub Pages site.
2. Keep the tab active while training.
3. Start with modest values for games, plies, and search simulations.
4. Increase them gradually if the phone remains responsive.
5. Export the brain periodically as a backup.

Mobile CPUs are much slower than desktop CPUs, so a small training batch is usually a better starting point.

## Project layout

    web/
        static frontend assets

    js/
        chess rules
        learner
        training
        Stockfish bridge
        board/UI
        persistence

    stockfish/
        bundled browser engine files

    models/
        optional exported/published model data

    data/
        optional local/published training metadata

## Design

The interface follows the project's KWII — Kawaii Design Language direction:

- colorful scrapbook-inspired surfaces
- rounded cards
- clear hierarchy
- playful details without sacrificing usability
- responsive layouts
- board-first match presentation
- mobile-friendly controls

## Important limitation

This is a learning experiment, not an established chess engine.

An estimated Elo shown by the app is an internal measurement. It should not be treated as an official chess rating.

The long-term goal is to experiment with increasingly strong learning systems, not to claim strength that has not been independently tested.

## License

Check the repository's license and the licenses of bundled third-party engine components before redistributing builds.


## Stockfish.js 19 browser engines

Stockfish.js is currently updated to Stockfish 19.

This edition of Stockfish.js comes in five flavors:

- **The large multi-threaded engine:** The strongest version of the engine, but it is very large (≈94MB) and requires the proper CORS headers for browser multi-threading. Files: `stockfish-19.js` & `stockfish-19.wasm`.
- **The large single-threaded engine:** Also large, but runs without the multi-threading CORS requirement. It cannot use multiple threads via the UCI `Threads` option. Files: `stockfish-19-single.js` & `stockfish-19-single.wasm`.
- **The lite multi-threaded engine:** The same multi-threaded build in a much smaller package (≈1.6MB) and considerably weaker than the large build. Files: `stockfish-19-lite.js` & `stockfish-19-lite.wasm`.
- **The lite single-threaded engine:** The small single-threaded build (≈1.6MB), intended for simple browser deployment. Files: `stockfish-19-lite-single.js` & `stockfish-19-lite-single.wasm`.
- **The ASM-JS engine:** Compiled to JavaScript rather than WASM, compatible with browsers that support JavaScript. It is very slow and weak and should only be used as a last resort. File: `stockfish-19-asm.js`.

The project currently exposes the Stockfish 19 variants in the engine selector. The browser build keeps the large engines available while using the single-threaded/lite variants when a smaller mobile download is preferable.

Source: [Stockfish.js](https://github.com/nmrugg/stockfish.js/).
