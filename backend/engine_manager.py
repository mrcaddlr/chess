#!/usr/bin/env python3
"""Download and cache the optional Chess Lab engines on first startup."""
import json, os, stat, tarfile, tempfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE_DIR = ROOT / ".chess-lab"
API = "https://api.github.com"

def _request(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Chess-Lab/1.0", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def _release(repo, tag):
    return json.loads(_request(f"{API}/repos/{repo}/releases/tags/{tag}"))

def _download(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(path.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "Chess-Lab/1.0"})
    with urllib.request.urlopen(req, timeout=120) as src, open(part, "wb") as dst:
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk:
                break
            dst.write(chunk)
    part.replace(path)

def _asset(repo, tag, predicate):
    rel = _release(repo, tag)
    for a in rel.get("assets", []):
        if predicate(a.get("name", "").lower()):
            return a["browser_download_url"]
    raise RuntimeError(f"no matching release asset for {repo}:{tag}")

def _extract_engine(archive, destination, prefix):
    with tarfile.open(archive, "r:*") as tf:
        members = [m for m in tf.getmembers() if m.isfile()]
        candidate = next((m for m in members if Path(m.name).name.startswith(prefix)), None)
        if candidate is None:
            raise RuntimeError(f"engine executable not found in {archive}")
        candidate.name = prefix
        tf.extract(candidate, ENGINE_DIR)
    out = ENGINE_DIR / prefix
    out.chmod(out.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return out

def ensure_stockfish(version):
    destination = ENGINE_DIR / f"stockfish-{version}"
    if destination.is_file() and os.access(destination, os.X_OK):
        return destination
    tag = f"sf_{version}"
    url = _asset("official-stockfish/Stockfish", tag, lambda n: n == f"stockfish-linux-x86-64-universal.tar.gz")
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as f:
        archive = Path(f.name)
    try:
        _download(url, archive)
        return _extract_engine(archive, destination, "stockfish")
    finally:
        archive.unlink(missing_ok=True)

def ensure_fairy():
    destination = ENGINE_DIR / "fairy-stockfish"
    if destination.is_file() and os.access(destination, os.X_OK):
        return destination
    tag = "fairy_sf_14_0_1_xq"
    url = _asset("fairy-stockfish/Fairy-Stockfish", tag, lambda n: n == "fairy-stockfish-largeboard_x86-64")
    _download(url, destination)
    destination.chmod(destination.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return destination

def ensure_lozza():
    destination = ENGINE_DIR / "lozza.js"
    if destination.is_file() and destination.stat().st_size > 10000:
        return destination
    url = "https://raw.githubusercontent.com/namanthanki/lozza/master/lozza.js"
    _download(url, destination)
    return destination

def ensure_all():
    ENGINE_DIR.mkdir(parents=True, exist_ok=True)
    results = {}
    for name, fn in (("fairy-stockfish", ensure_fairy),
                     ("lozza.js", ensure_lozza)):
        try:
            results[name] = str(fn())
        except Exception as exc:
            results[name] = f"ERROR: {exc}"
    return results

if __name__ == "__main__":
    print(json.dumps(ensure_all(), indent=2))
