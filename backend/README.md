# Chess Lab PC backend

Chess Lab is now a local PC-compute application.

## Architecture

- GitHub Pages is only the download/landing page.
- The actual Chess Lab UI is served locally by `backend/server.py`.
- Node.js runs the learner/training worker on the PC.
- Stockfish 19 runs natively on the PC through UCI.
- No browser-side Stockfish is used for training or matches.
- Training state, checkpoints, history, and versioned models are stored locally outside Git.

The local server uses Python's built-in `http.server`; keep it on a trusted LAN. Python documents this server as a basic server rather than a production internet-facing server. citeturn4search0

## Run

From the repository root:

    python3 backend/server.py

Then open:

    http://127.0.0.1:8787/

For a phone on the same Wi-Fi, use:

    http://YOUR-PC-IP:8787/

The backend prints the pairing token used by the controller.

## Stockfish 19

Chess Lab requires **Stockfish 19** for Stockfish training/evaluation and engine matches. The default training engine setting is **Full Single**, meaning one Stockfish thread.

Stockfish 19 is the current official stable release, and the official Linux downloads provide a universal x86-64 binary. citeturn0search0turn0search1

On Linux, run:

    bash backend/setup-stockfish19.sh

The script downloads the official Stockfish 19 Linux x86-64 universal release into:

    .chess-lab/stockfish-19

Chess Lab verifies the UCI engine identity before using it. Older Stockfish builds, Fairy-Stockfish, and unrelated engines are rejected for the Stockfish 19 path.

You can override the executable with:

    CHESS_LAB_STOCKFISH=/full/path/to/stockfish-19 python3 backend/server.py

Stockfish communicates with Chess Lab through the UCI protocol. citeturn0search2

## Training pipeline

Each generation now does:

1. Load the latest learner model/checkpoint.
2. Run learner-vs-learner, learner-vs-Stockfish 19, or mixed games.
3. Use the configured parallel-game limit.
4. Store learner positions in the replay buffer.
5. Run batched gradient updates.
6. Save the learner model atomically.
7. Save a versioned model as `.chess-lab-models/generation-XXXXXX.json`.
8. Run a Stockfish 19 evaluation match.
9. Store wins/draws/losses, score, and an estimated Elo metric.
10. Persist generation history.
11. Update the live UI throughout the run.

### Training modes

- **Train one generation**: one generation, then stop.
- **Continuous generations**: keep generating and evaluating until Stop.
- **Train until target Elo estimate**: keep generating until the evaluation estimate reaches the configured target.

The Elo value shown by the training UI is an internal estimate derived from the evaluation score. It is not an official chess rating.

## Pause, stop, and checkpoint

Pause/resume is handled by the native worker, so it does not depend on an open browser tab.

Checkpoint saves the current learner state to:

    .chess-lab-checkpoint.json

The checkpoint contains the learner model, generation counters, and a bounded replay-buffer tail. The worker automatically restores it on startup.

Stopping a run cancels the active worker generation cleanly and prevents that partial generation from being counted as completed.

## Recovery

If the browser closes, training can continue because the native worker belongs to the PC backend.

If the backend is restarted, it restores the latest model/checkpoint and generation counters.

Completed models are kept as immutable generation snapshots in:

    .chess-lab-models/

Training history is persisted in:

    .chess-lab-training-history.json

## GitHub updates

The backend keeps a lightweight Git polling fallback. The automatic Cloudflare Quick Tunnel has been removed because its random public URL was not a stable or appropriate long-term webhook endpoint.

The normal workflow is:

GitHub Pages / GitHub repository
        ↓
download or update the local checkout
        ↓
PC backend
        ↓
local Chess Lab UI + learner + Stockfish

The local backend should not be exposed directly to the public internet.

## Notes

Node.js is only used for the native compute worker. Browser-side engine execution remains disabled.

Stockfish 19 itself is GPL-licensed, so preserve the upstream license/source notices when redistributing the engine. citeturn0search11
