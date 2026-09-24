#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST="127.0.0.1"
PORT="${CHESS_LAB_PORT:-8787}"
URL="http://${HOST}:${PORT}/"

cd "$ROOT"

# Prefer the same Python interpreter the user uses to run the launcher.
PYTHON="${CHESS_LAB_PYTHON:-}"
if [[ -z "$PYTHON" ]]; then
  if command -v python3 >/dev/null 2>&1; then PYTHON="$(command -v python3)"
  elif command -v python >/dev/null 2>&1; then PYTHON="$(command -v python)"
  else
    echo "Chess Lab: Python 3 was not found."
    exit 1
  fi
fi

# If an old bridge is already serving this port, reuse it.
if curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1; then
  echo "Chess Lab backend already running at $URL"
else
  echo "Starting Chess Lab backend..."
  nohup "$PYTHON" "$ROOT/backend/server.py" >"$ROOT/.chess-lab/backend.log" 2>&1 &
  BACKEND_PID=$!
  trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT

  for _ in {1..50}; do
    if curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo "Chess Lab backend exited. Log:"
      tail -n 80 "$ROOT/.chess-lab/backend.log" 2>/dev/null || true
      exit 1
    fi
    sleep 0.2
  done

  if ! curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1; then
    echo "Chess Lab backend did not become ready."
    tail -n 80 "$ROOT/.chess-lab/backend.log" 2>/dev/null || true
    exit 1
  fi
fi

echo "Chess Lab ready: $URL"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v gio >/dev/null 2>&1; then
  gio open "$URL" >/dev/null 2>&1 &
else
  echo "Open $URL in your browser."
fi

# Keep the launcher alive when it owns the backend, so the process remains attached
# to this launcher instead of immediately disappearing.
if [[ -n "${BACKEND_PID:-}" ]]; then
  wait "$BACKEND_PID"
fi
