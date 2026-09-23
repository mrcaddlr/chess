# Local Stockfish 19

The GitHub Pages deployment downloads the Stockfish.js 19 browser build during deployment and places the single-threaded lite engine in this directory of the published site.

The app loads `stockfish/stockfish-19-lite-single.js` locally instead of fetching an engine from a third-party CDN at runtime.

Stockfish is distributed under the GPL-3.0 license. See `Copying.txt`.
