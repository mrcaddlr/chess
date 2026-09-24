#!/usr/bin/env python3
"""Chess Lab launcher: start the local bridge, wait for health, open the UI."""
from __future__ import annotations
import os, pathlib, shutil, subprocess, sys, time, urllib.request, webbrowser

ROOT=pathlib.Path(__file__).resolve().parent
host="127.0.0.1"
port=int(os.environ.get("CHESS_LAB_PORT","8787"))
url=f"http://{host}:{port}/"
log=ROOT/".chess-lab"/"backend.log"
log.parent.mkdir(parents=True,exist_ok=True)

def healthy():
    try:
        with urllib.request.urlopen(url+"api/health",timeout=1) as r:
            return r.status == 200
    except Exception:
        return False

if not healthy():
    log_handle=log.open("a",encoding="utf-8")
    proc=subprocess.Popen([sys.executable,str(ROOT/"backend"/"server.py")],
                          cwd=ROOT,stdout=log_handle,stderr=subprocess.STDOUT,
                          start_new_session=True)
    for _ in range(50):
        if healthy():
            break
        if proc.poll() is not None:
            log_handle.close()
            print(log.read_text(encoding="utf-8",errors="replace")[-8000:])
            raise SystemExit(proc.returncode or 1)
        time.sleep(.2)
    log_handle.close()

if not healthy():
    print(f"Chess Lab backend did not become ready at {url}")
    print(log.read_text(encoding="utf-8",errors="replace")[-8000:])
    raise SystemExit(1)

print(f"Chess Lab ready: {url}")
webbrowser.open(url)
