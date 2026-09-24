#!/usr/bin/env bash
set -Eeuo pipefail

# Chess Lab updater + launcher.
# This script intentionally lives in the repo and updates itself from origin/main
# before starting the current version of Chess Lab.

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST="127.0.0.1"
PORT="${CHESS_LAB_PORT:-8787}"
URL="http://${HOST}:${PORT}/"
LOG_DIR="$ROOT/.chess-lab"
LOG_FILE="$LOG_DIR/restart.log"

mkdir -p "$LOG_DIR"
cd "$ROOT"

log() {
  printf '[Chess Lab] %s\n' "$*"
}

die() {
  printf '[Chess Lab] ERROR: %s\n' "$*" >&2
  exit 1
}

# Always operate on the repository this script belongs to.
git rev-parse --show-toplevel >/dev/null 2>&1 || die "This is not a Git repository."
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Stop anything currently listening on Chess Lab's port.
log "Stopping any previous Chess Lab server on port $PORT..."
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
else
  OLD_PIDS="$(ss -ltnp 2>/dev/null | awk -v p=":${PORT}" '$4 ~ p"$" {gsub(/.*pid=/,""); gsub(/,.*/,""); print}' | sort -u || true)"
  if [[ -n "$OLD_PIDS" ]]; then
    kill $OLD_PIDS 2>/dev/null || true
    sleep 0.5
    kill -9 $OLD_PIDS 2>/dev/null || true
  fi
fi

# Remove engines that are no longer part of Chess Lab. These are generated local files, so git reset cannot remove them.\nrm -f "$ROOT/.chess-lab/stockfish-18" "$ROOT/.chess-lab/stockfish-18-lite"\n\n# Fetch the current GitHub version, then make the working tree exactly match
# origin/main. This avoids pull/merge conflicts from stale local files.
log "Updating from GitHub..."
git fetch --prune origin main || die "Could not fetch origin/main."
git reset --hard origin/main || die "Could not reset to origin/main."

# The update may have replaced this script or the application itself.
# Continue using the freshly updated repository files.
cd "$ROOT"

PYTHON="${CHESS_LAB_PYTHON:-}"
if [[ -z "$PYTHON" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON="$(command -v python3)"
  elif command -v python >/dev/null 2>&1; then
    PYTHON="$(command -v python)"
  else
    die "Python 3 was not found."
  fi
fi

SERVER="$ROOT/backend/server.py"
[[ -f "$SERVER" ]] || die "The updated Chess Lab backend was not found at backend/server.py."

log "Starting current Chess Lab backend..."
nohup "$PYTHON" "$SERVER" >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log "Waiting for Chess Lab..."
READY=0
for _ in {1..60}; do
  if curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi

  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log "Backend exited. Last log output:"
    tail -n 80 "$LOG_DIR/backend.log" 2>/dev/null || true
    exit 1
  fi

  sleep 0.25
done

[[ "$READY" == "1" ]] || {
  log "Backend did not become ready. Last log output:"
  tail -n 80 "$LOG_DIR/backend.log" 2>/dev/null || true
  exit 1
}

log "Chess Lab is ready at $URL"
log "Opening browser..."

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v gio >/dev/null 2>&1; then
  gio open "$URL" >/dev/null 2>&1 &
else
  log "Open $URL manually."
fi

# Keep the process alive while the server is running.
wait "$BACKEND_PID"
