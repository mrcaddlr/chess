# Chess Lab PC backend

The PC backend now has two layers:

1. Native learner compute: when Node.js is available, the backend starts `node-compute-worker.js`. It loads the existing Chess Lab neural-network and chess-search code directly under Node, performs self-play and gradient updates without a browser tab, and persists the current brain in `.chess-lab-native-model.json`.
2. Browser bridge: the Python server hosts the same Chess Lab frontend and provides authenticated WebSocket control/status for an Android or second-browser controller.

## Run

From the repository root:

    python3 backend/server.py

The server listens on port `8787` by default.

Open the PC-hosted Chess Lab normally on the PC. A phone on the same Wi-Fi can open `http://YOUR-PC-IP:8787/?controller=1`.

The server prints a pairing token.

## Native compute

The native trainer uses the repository's existing JavaScript model and search implementation. Node.js is required for this path. If Node.js is unavailable, the browser training implementation remains available instead.

Native training is started by the same Chess Lab Start training control. The backend owns the training job, so closing the controller browser does not stop the native worker.

Native model state is kept outside the repository at `.chess-lab-native-model.json` and is created after native training produces a model. The browser bridge also exposes authenticated `/api/model` GET/POST endpoints so a controller can pull or push the current model.\n\nIf a Stockfish executable is available on the PC as `stockfish` (or via `CHESS_LAB_STOCKFISH`), each completed generation can automatically run a learner-vs-Stockfish evaluation and report wins/draws/losses. If Stockfish is not installed, training still works and the evaluation is skipped.

## Current protocol

- `GET /api/health`
- `GET /api/status`
- `GET /api/pairing`
- authenticated `/ws`
- controller commands for start/stop and status relay
- live native training progress
- native generation/model persistence\n- native Stockfish discovery and end-of-generation evaluation\n- authenticated browser model upload/download

The bridge does not expose shell commands or arbitrary filesystem operations.

## PC setup\n\n1. Install Node.js. The current Node.js LTS line is v24.x.\n2. Make sure `node -v` works in the same terminal that starts the bridge.\n3. Optional: install a `stockfish` executable and make sure `stockfish --version` works, or set `CHESS_LAB_STOCKFISH=/full/path/to/stockfish`.\n4. From the repository root run `python3 backend/server.py`.\n5. On the PC open `http://127.0.0.1:8787/`.\n6. Find the PC LAN address with `hostname -I` and open `http://PC_IP:8787/?controller=1` on the Android device while both are on the same Wi-Fi.\n\nThe Python bridge is intentionally a small trusted-LAN service. Python documents `http.server` as a basic server rather than a production-grade public server.\n\n## Important limitation

This local backend is intended for a trusted LAN. Python's built-in HTTP server facilities are basic rather than production-grade, so it should not be exposed directly to the public internet.

GitHub Pages remains the public static deployment and browser-only fallback. Public Pages-to-PC control still needs a secure WSS/tunnel layer; the local PC-hosted copy is the reliable LAN path for this milestone.
