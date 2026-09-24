#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/.chess-lab"
ARCHIVE="$DIR/stockfish-19.tar.gz"
URL="https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz"
mkdir -p "$DIR"
echo "Downloading the official Stockfish 19 Linux x86-64 universal build..."
curl -fL --retry 3 "$URL" -o "$ARCHIVE"
TMP="$DIR/stockfish-19-extract"
rm -rf "$TMP"
mkdir -p "$TMP"
tar -xzf "$ARCHIVE" -C "$TMP"
ENGINE="$(find "$TMP" -type f -name 'stockfish-ubuntu-x64*' -o -name 'stockfish' | head -n 1)"
if [[ -z "$ENGINE" ]]; then
  ENGINE="$(find "$TMP" -type f -perm -u+x | head -n 1)"
fi
if [[ -z "$ENGINE" ]]; then
  echo "Could not find the Stockfish executable in the downloaded archive." >&2
  exit 1
fi
install -m 0755 "$ENGINE" "$DIR/stockfish-19"
rm -rf "$TMP" "$ARCHIVE"
echo
echo "Installed: $DIR/stockfish-19"
echo "Chess Lab will verify that it identifies as Stockfish 19 before using it."
"$DIR/stockfish-19" <<< $'uci\nquit' | grep -E 'id name|id version' || true
