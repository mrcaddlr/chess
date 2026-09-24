#!/usr/bin/env python3
"""Chess Lab local PC bridge."""
import base64, hashlib, json, os, secrets, socket, ssl, struct, subprocess, threading, time, shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parent.parent
HOST=os.environ.get("CHESS_LAB_HOST","0.0.0.0")
PORT=int(os.environ.get("CHESS_LAB_PORT","8787"))
TOKEN_FILE=ROOT/".chess-lab-pairing"
clients=[]; clients_lock=threading.Lock()
state={"compute":False,"training":False,"paused":False,"history":[],"generation":0,"game":0,"totalGames":0,"positions":0,"updates":0,"totalUpdates":0,"ply":0,"fen":"start","turn":"w","loss":None,"gamesPerMinute":0,"phase":"idle","updated":time.time(),"stockfish":None,"evaluation":None,"completedGames":0,"completedPositions":0,"completedLoss":None,"error":""}

def start_public_https():
    """
    Start a stable Cloudflare Tunnel only when explicitly configured.
    Quick tunnels are kept as a fallback for development, but the stable
    named-tunnel mode uses CHESS_LAB_CLOUDFLARE_TOKEN.
    """
    token=os.environ.get("CHESS_LAB_CLOUDFLARE_TOKEN","").strip()
    if not token or shutil.which("cloudflared") is None:
        return None
    cmd=["cloudflared","tunnel","run","--token",token]
    try:
        proc=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        state["publicTunnel"]="configured"
        return proc
    except Exception as e:
        state["publicTunnelError"]=str(e)
        return None

def pairing_token():
    if TOKEN_FILE.exists(): return TOKEN_FILE.read_text().strip()
    token=secrets.token_urlsafe(18); TOKEN_FILE.write_text(token)
    try: os.chmod(TOKEN_FILE,0o600)
    except OSError: pass
    return token
TOKEN=pairing_token()
UPDATE_LOCK=threading.Lock()
UPDATE_LAST=""

NATIVE_SCRIPT=ROOT/"backend"/"node-compute-worker.js"
NATIVE_STATE=ROOT/".chess-lab-native-model.json"
CHECKPOINT_STATE=ROOT/".chess-lab-checkpoint.json"
HISTORY_STATE=ROOT/".chess-lab-training-history.json"
MODEL_DIR=ROOT/".chess-lab-models"
native_proc=None
native_lock=threading.Lock()
native_ready=False
native_generation=0

def find_node():
    import shutil
    found=shutil.which("node")
    if found:return found
    home=Path.home()
    candidates=[
        home/".nvm/current/bin/node",
        home/".local/bin/node",
        home/".volta/bin/node",
        Path("/usr/local/bin/node"),
        Path("/usr/bin/node"),
    ]
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate,os.X_OK):return str(candidate)
    return None

def native_available():
    return bool(find_node()) and NATIVE_SCRIPT.exists()

def load_native_model():
    if NATIVE_STATE.exists():
        try:return json.loads(NATIVE_STATE.read_text())
        except Exception:return None
    return None

def load_training_history():
    if HISTORY_STATE.exists():
        try:
            data=json.loads(HISTORY_STATE.read_text())
            return data if isinstance(data,list) else []
        except Exception:
            return []
    return []

def save_training_history(history):
    tmp=HISTORY_STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(history[-100:],separators=(",",":")))
    tmp.replace(HISTORY_STATE)

state["history"]=load_training_history()
if state["history"]: state["generation"]=int(state["history"][-1].get("generation") or 0)

def save_native_model(model):
    tmp=NATIVE_STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(model,separators=(",",":")))
    tmp.replace(NATIVE_STATE)

def save_versioned_model(model,generation):
    MODEL_DIR.mkdir(parents=True,exist_ok=True)
    target=MODEL_DIR/f"generation-{int(generation):06d}.json"
    tmp=target.with_suffix(".tmp")
    tmp.write_text(json.dumps(model,separators=(",",":")))
    tmp.replace(target)
    latest=MODEL_DIR/"latest.json"
    latest_tmp=latest.with_suffix(".tmp")
    latest_tmp.write_text(json.dumps({"generation":int(generation),"file":target.name},separators=(",",":")))
    latest_tmp.replace(latest)

def start_native():
    global native_proc,native_ready,native_generation
    with native_lock:
        if native_proc and native_proc.poll() is None:return True
        if not native_available():return False
        import subprocess
        native_proc=subprocess.Popen([find_node(),str(NATIVE_SCRIPT)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
        model=load_native_model()
        checkpoint=None
        if CHECKPOINT_STATE.exists():
            try: checkpoint=json.loads(CHECKPOINT_STATE.read_text())
            except Exception: checkpoint=None
        native_generation=int((checkpoint or {}).get("generation") or native_generation or 0)
        native_proc.stdin.write(json.dumps({"type":"init","brain":model,"generation":native_generation,"gamesCompleted":int((checkpoint or {}).get("gamesCompleted") or 0),"resumeCheckpoint":True})+"\n")
        native_proc.stdin.flush()
        line=native_proc.stdout.readline()
        if not line:return False
        msg=json.loads(line)
        native_ready=msg.get("type")=="ready"
        native_generation=int(msg.get("generation") or 0)
        state["stockfish"]=bool(msg.get("stockfish"));state["stockfishInfo"]=msg.get("stockfishInfo") or STOCKFISH_INFO
        state["stockfishInfo"]=msg.get("stockfishInfo")
        state["generation"]=native_generation
        return native_ready

def native_stop():
    with native_lock:
        if native_proc and native_proc.poll() is None:
            try:
                native_proc.stdin.write(json.dumps({"type":"stop"})+"\n");native_proc.stdin.flush()
                return True
            except Exception:return False
    return False

def native_train(data):
    global native_generation
    if not start_native():raise RuntimeError("Node.js is required for native PC training")
    native_proc.stdin.write(json.dumps({"type":"train",**data})+"\n")
    native_proc.stdin.flush()
    while True:
            line=native_proc.stdout.readline()
            if not line:raise RuntimeError("native trainer exited")
            msg=json.loads(line)
            typ=msg.get("type")
            if typ=="evaluation-progress":
                state["phase"]="stockfish-eval";state["evaluation"]={k:msg.get(k,0) for k in ("game","totalGames","wins","draws","losses")};state["updated"]=time.time();broadcast({"type":"status","data":state})
            elif typ=="live":
                state["paused"]=False
                for k in ("game","totalGames","positions","phase","ply","fen","turn"):
                    if k in msg:state[k]=msg[k]
                state["updated"]=time.time();broadcast({"type":"status","data":state})
            elif typ=="progress":
                for k in ("game","totalGames","positions","phase","updates","totalUpdates","loss"):
                    if k in msg:state[k]=msg[k]
                started=float(state.get("trainingStartedAt") or time.time())
                elapsed=max(.001,(time.time()-started)/60)
                state["gamesPerMinute"]=float(msg.get("game") or state.get("game") or 0)/elapsed
                state["updated"]=time.time();broadcast({"type":"status","data":state})
            elif typ=="checkpoint":
                state["phase"]="checkpoint-saved";state["updated"]=time.time();broadcast({"type":"status","data":state})
            elif typ=="paused":
                state["paused"]=True;state["phase"]="paused";state["updated"]=time.time();broadcast({"type":"status","data":state})
            elif typ=="resumed":
                state["paused"]=False;state["phase"]="resuming";state["updated"]=time.time();broadcast({"type":"status","data":state})
            elif typ=="complete":
                save_native_model(msg["brain"]);native_generation=int(msg.get("generation") or (native_generation+1))
                state["generation"]=native_generation;state["training"]=False;state["paused"]=False;state["phase"]="generation-complete";state["error"]="";entry={"generation":native_generation,"games":msg.get("games",0),"positions":msg.get("positions",0),"loss":msg.get("loss"),"evaluation":msg.get("evaluation"),"savedAt":time.time()};state["history"]=list(state.get("history") or [])[-99:]+[entry];save_training_history(state["history"]);save_versioned_model(msg.get("brain") or {},native_generation);state["evaluation"]=msg.get("evaluation");state["stockfish"]=bool(msg.get("evaluation",{}).get("available")) if isinstance(msg.get("evaluation"),dict) else state.get("stockfish")
                state["game"]=msg.get("games",0);state["totalGames"]=msg.get("games",0);state["completedGames"]=msg.get("games",0);state["completedPositions"]=msg.get("positions",0);state["completedLoss"]=msg.get("loss");state["loss"]=msg.get("loss");state["positions"]=msg.get("positions",0);state["ply"]=0;state["fen"]="start";state["turn"]="w";state["updates"]=0;state["totalUpdates"]=0
                state["updated"]=time.time();broadcast({"type":"status","data":state});return msg
            elif typ=="error":raise RuntimeError(msg.get("message","native trainer error"))

def run_native_training(data):
    try:
        mode=str(data.get("mode") or "generation")
        while state.get("training"):
            result=native_train(data)
            ev=result.get("evaluation") if isinstance(result,dict) else None
            estimated=float(ev.get("estimatedElo")) if isinstance(ev,dict) and ev.get("estimatedElo") is not None else None
            target=float(data.get("targetElo") or 1800)
            if mode=="generation": break
            if mode=="target" and estimated is not None and estimated>=target:
                state["phase"]="target-reached";state["training"]=False;break
            if state.get("training"):
                state["phase"]="next-generation";state["updated"]=time.time();broadcast({"type":"status","data":state})
        if state.get("phase") not in ("target-reached","error"): state["training"]=False
    except Exception as e:
        state["training"]=False;state["phase"]="error";state["error"]=str(e)
    state["updated"]=time.time();broadcast({"type":"status","data":state})

def check_for_updates():
    global UPDATE_LAST
    with UPDATE_LOCK:
        try:
            remote=subprocess.run(["git","ls-remote","origin","refs/heads/main"],cwd=ROOT,capture_output=True,text=True,timeout=15)
            if remote.returncode!=0:return
            remote_sha=remote.stdout.split()[0] if remote.stdout.split() else ""
            local=subprocess.run(["git","rev-parse","HEAD"],cwd=ROOT,capture_output=True,text=True,timeout=5)
            local_sha=local.stdout.strip()
            if not remote_sha or remote_sha==local_sha:return
            dirty=subprocess.run(["git","status","--porcelain"],cwd=ROOT,capture_output=True,text=True,timeout=5)
            if dirty.stdout.strip():
                print("Local changes detected. Auto-update is resetting the local checkout to the GitHub version.")
            print("Update detected on GitHub. Pulling...")
            pulled=subprocess.run(["git","fetch","origin","main"],cwd=ROOT,capture_output=True,text=True,timeout=30)
            if pulled.returncode!=0:
                print("Auto-update fetch failed: "+(pulled.stdout+pulled.stderr).strip())
                return
            reset=subprocess.run(["git","reset","--hard","origin/main"],cwd=ROOT,capture_output=True,text=True,timeout=30)
            if reset.returncode==0:
                UPDATE_LAST=remote_sha
                print("Update pulled. Refreshing connected pages...")
                broadcast({"type":"reload","reason":"github-update","commit":remote_sha})
            else:
                print("Auto-update reset failed: "+(reset.stdout+reset.stderr).strip())
        except Exception as e:
            print("Auto-update check failed: "+str(e))

def update_loop():
    # GitHub push-triggered updates are preferred. Keep a lightweight fallback
    # only while the local server is running.
    while True:
        time.sleep(60)
        check_for_updates()

def ws_send(sock,obj):
    payload=json.dumps(obj,separators=(",",":")).encode()
    n=len(payload); frame=bytearray([0x81])
    if n<126: frame.append(n)
    elif n<65536: frame.append(126); frame.extend(struct.pack("!H",n))
    else: frame.append(127); frame.extend(struct.pack("!Q",n))
    frame.extend(payload); sock.sendall(frame)

def ws_recv(sock):
    h=sock.recv(2)
    if len(h)<2:return None
    b1,b2=h; opcode=b1&15; masked=bool(b2&128); n=b2&127
    if opcode==8:return None
    if n==126:n=struct.unpack("!H",sock.recv(2))[0]
    elif n==127:n=struct.unpack("!Q",sock.recv(8))[0]
    mask=sock.recv(4) if masked else b""; data=bytearray()
    while len(data)<n:
        chunk=sock.recv(min(65536,n-len(data)))
        if not chunk:return None
        data.extend(chunk)
    if masked:
        for i in range(n):data[i]^=mask[i%4]
    if opcode==9:
        out=bytearray([0x8A,len(data)]);out.extend(data);sock.sendall(out);return ws_recv(sock)
    if opcode!=1:return ws_recv(sock)
    try:return json.loads(data.decode())
    except Exception:return None

def broadcast(message,exclude=None):
    with clients_lock: peers=list(clients)
    for c in peers:
        if c is exclude: continue
        try: ws_send(c["sock"],message)
        except Exception:
            with clients_lock:
                try: clients.remove(c)
                except ValueError: pass

STOCKFISH_INFO={"available":False,"path":None,"name":None,"version":None,"error":"Stockfish 19 not detected"}

def probe_stockfish19():
    import shutil
    candidates=[]
    configured=os.environ.get("CHESS_LAB_STOCKFISH","")
    if configured:candidates.append(configured)
    candidates.extend([str(ROOT/".chess-lab/stockfish-19"),"stockfish","stockfish-ubuntu","stockfish.exe"])
    for candidate in candidates:
        if os.path.sep in candidate and not Path(candidate).is_file():continue
        found=candidate if os.path.sep in candidate else shutil.which(candidate)
        if not found:continue
        try:
            p=subprocess.Popen([found],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            p.stdin.write("uci\n");p.stdin.flush()
            name=version=""
            deadline=time.time()+5
            while time.time()<deadline:
                line=p.stdout.readline()
                if not line:break
                line=line.strip()
                if line.startswith("id name "):name=line[8:].strip()
                elif line.startswith("id version "):version=line[11:].strip()
                elif line=="uciok":break
            p.kill()
            ok=("stockfish" in name.lower() and (version.startswith("19") or " 19" in name))
            if ok:return {"available":True,"path":found,"name":name,"version":version or "19"}
        except Exception:pass
    return {"available":False,"path":None,"name":None,"version":None,"error":"Stockfish 19 is required. Install the official Stockfish 19 Linux binary or set CHESS_LAB_STOCKFISH."}

STOCKFISH_INFO=probe_stockfish19()

def native_engine_move(fen, depth=12, allowed_moves=None, engine_id="sf19-full-single", threads=1):
    profiles={
        "sf19-full-single":{"path":STOCKFISH_INFO.get("path"),"threads":1},
        "sf19-full-multi":{"path":STOCKFISH_INFO.get("path"),"threads":max(2,int(threads or 2))},
        "sf19-lite-single":{"path":STOCKFISH_INFO.get("path"),"threads":1},
        "sf19-lite-multi":{"path":STOCKFISH_INFO.get("path"),"threads":max(2,int(threads or 2))},
        "sf18-full-single":{"path":str(ROOT/".chess-lab/stockfish-18"),"threads":1},
        "sf18-full-multi":{"path":str(ROOT/".chess-lab/stockfish-18"),"threads":max(2,int(threads or 2))},
        "sf18-lite-single":{"path":str(ROOT/".chess-lab/stockfish-18"),"threads":1},
        "sf18-lite-multi":{"path":str(ROOT/".chess-lab/stockfish-18"),"threads":max(2,int(threads or 2))}
    }
    profile=profiles.get(str(engine_id),profiles["sf19-full-single"])
    engine=profile["path"]
    if not engine or not Path(engine).is_file(): raise RuntimeError("Selected engine is not installed: "+str(engine_id))
    allowed_moves=[str(x) for x in (allowed_moves or []) if x]
    p=subprocess.Popen([engine],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    try:
        def send(s): p.stdin.write(s+"\n");p.stdin.flush()
        send("uci");send("setoption name Threads value "+str(profile["threads"]));send("isready");send("ucinewgame");send("position fen "+fen)
        cmd="go depth "+str(max(1,min(20,int(depth or 12))))
        if allowed_moves: cmd+=" searchmoves "+" ".join(allowed_moves)
        send(cmd)
        deadline=time.time()+max(15,int(depth or 12)*3)
        while time.time()<deadline:
            line=p.stdout.readline()
            if line.startswith("bestmove "): return line.split()[1]
            if not line and p.poll() is not None: break
        raise RuntimeError("Selected engine timed out")
    finally:
        try:p.kill()
        except Exception:pass

def engine_availability():
    sf19=bool(STOCKFISH_INFO.get('available')); sf18=Path(ROOT/'.chess-lab/stockfish-18').is_file(); lozza=Path(ROOT/'.chess-lab/lozza.js').is_file(); fairy=Path(ROOT/'.chess-lab/fairy-stockfish').is_file()
    return {'sf19-full-single':{'available':sf19},'sf19-full-multi':{'available':sf19},'sf19-lite-single':{'available':sf19},'sf19-lite-multi':{'available':sf19},'sf18-full-single':{'available':sf18},'sf18-full-multi':{'available':sf18},'sf18-lite-single':{'available':sf18},'sf18-lite-multi':{'available':sf18},'lozza':{'available':lozza},'fairy-stockfish':{'available':fairy},'custom-wasm':{'available':True}}

class Handler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    server_version="ChessLabBridge/0.1"
    def log_message(self,fmt,*args): pass
    def _json(self,obj,status=200):
        raw=json.dumps(obj).encode()
        self.send_response(status);self.send_header("Content-Type","application/json");origin=self.headers.get("Origin","");self.send_header("Access-Control-Allow-Origin",origin if origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:") else "null");self.send_header("Access-Control-Allow-Headers","Content-Type, X-Chess-Lab-Token");self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
        self.send_header("Cache-Control","no-store");self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def _training_command_http(self, command):
        if self.headers.get("X-Chess-Lab-Token","")!=TOKEN:
            return self._json({"error":"invalid pairing token"},401)
        if command=="start-training":
            n=int(self.headers.get("Content-Length","0"))
            data=json.loads(self.rfile.read(n) or b"{}")
            if state.get("training"): return self._json({"ok":True,"alreadyRunning":True})
            if not native_available():
                state["phase"]="error";state["error"]="PC training worker is unavailable. Node.js could not be launched by the backend.";state["updated"]=time.time()
                broadcast({"type":"status","data":state})
                return self._json({"error":state["error"]},503)
            state["training"]=True;state["paused"]=False;state["phase"]="starting";state["error"]="";state["trainingStartedAt"]=time.time()
            state["game"]=0;state["totalGames"]=int(data.get("games",data.get("gamesPerGeneration",100)) or 100)
            state["positions"]=0;state["updates"]=0;state["totalUpdates"]=int(data.get("updates",400) or 400);state["updated"]=time.time()
            broadcast({"type":"status","data":state})
            threading.Thread(target=run_native_training,args=(data,),daemon=True).start()
            return self._json({"ok":True,"started":True})
        if command=="stop-training":
            native_stop();state["training"]=False;state["paused"]=False;state["phase"]="stopping"
        elif command in ("pause-training","resume-training"):
            with native_lock:
                if native_proc and native_proc.poll() is None:
                    native_proc.stdin.write(json.dumps({"type":"pause" if command=="pause-training" else "resume"})+"\n");native_proc.stdin.flush()
            state["paused"]=command=="pause-training";state["phase"]="paused" if state["paused"] else "resuming"
        elif command=="checkpoint-training":
            with native_lock:
                if native_proc and native_proc.poll() is None:
                    native_proc.stdin.write(json.dumps({"type":"checkpoint"})+"\n");native_proc.stdin.flush()
            state["phase"]="checkpoint-saving"
        else:
            return self._json({"error":"unknown training command"},400)
        state["updated"]=time.time();broadcast({"type":"status","data":state})
        return self._json({"ok":True,"command":command})

    def do_OPTIONS(self):
        self.send_response(204);self.send_header("Access-Control-Allow-Origin",self.headers.get("Origin",""));self.send_header("Access-Control-Allow-Headers","Content-Type, X-Chess-Lab-Token");self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS");self.end_headers()
    def do_POST(self):
        p=urlparse(self.path)
        if p.path in ("/api/training/start","/api/training/stop","/api/training/pause","/api/training/resume","/api/training/checkpoint"):
            command={"/api/training/start":"start-training","/api/training/stop":"stop-training","/api/training/pause":"pause-training","/api/training/resume":"resume-training","/api/training/checkpoint":"checkpoint-training"}[p.path]
            return self._training_command_http(command)
        
        if p.path=="/api/github-webhook":
            n=int(self.headers.get("Content-Length","0"))
            body=self.rfile.read(n)
            secret=os.environ.get("CHESS_LAB_GITHUB_WEBHOOK_SECRET","")
            signature=self.headers.get("X-Hub-Signature-256","")
            if not secret:
                return self._json({"error":"webhook secret is not configured"},503)
            expected="sha256="+__import__("hmac").new(secret.encode(),body,__import__("hashlib").sha256).hexdigest()
            if not __import__("hmac").compare_digest(signature,expected):
                return self._json({"error":"invalid webhook signature"},401)
            if self.headers.get("X-GitHub-Event","")!="push":
                return self._json({"ok":True,"ignored":True})
            try:
                payload=json.loads(body or b"{}")
                ref=payload.get("ref","")
                if ref!="refs/heads/main":
                    return self._json({"ok":True,"ignored":True,"ref":ref})
                threading.Thread(target=check_for_updates,daemon=True).start()
                return self._json({"ok":True,"update":"queued"})
            except Exception as e:
                return self._json({"error":str(e)},400)

        if p.path=="/api/engine-move":
            if self.headers.get("X-Chess-Lab-Token","")!=TOKEN:
                return self._json({"error":"invalid pairing token"},401)
            try:
                n=int(self.headers.get("Content-Length","0"))
                data=json.loads(self.rfile.read(n) or b"{}")
                move=native_engine_move(data.get("fen",""),data.get("depth",12),data.get("allowedMoves",[]),data.get("engine","sf19-full-single"),data.get("threads",1))
                return self._json({"move":move})
            except Exception as e:
                return self._json({"error":str(e)},400)

        if p.path!="/api/model":return self.send_error(404)
        if self.headers.get("X-Chess-Lab-Token","")!=TOKEN:return self._json({"error":"invalid pairing token"},401)
        try:
            n=int(self.headers.get("Content-Length","0")); data=json.loads(self.rfile.read(n) or b"{}"); model=data.get("model")
            if not isinstance(model,dict):return self._json({"error":"model must be an object"},400)
            save_native_model(model)
            return self._json({"ok":True,"generation":native_generation})
        except Exception as e:return self._json({"error":str(e)},400)
    def do_GET(self):
        p=urlparse(self.path)
        if p.path=="/api/health": return self._json({"ok":True,"service":"chess-lab-pc-bridge","version":"0.62.0","origin":"local","host":"127.0.0.1:8787"})
        if p.path=="/api/status":
            with clients_lock: connected=len(clients)
            return self._json({**state,"connectedClients":connected,"pairingRequired":True,"nativeCompute":native_available(),"trainingAvailable":native_available(),"nativeRunning":bool(native_proc and native_proc.poll() is None),"generation":native_generation,"stockfishInfo":state.get("stockfishInfo") or STOCKFISH_INFO,"engines":engine_availability(),"localOrigin":True,"websocketPath":"/ws"})
        if p.path=="/api/pairing": return self._json({"token":TOKEN})
        if p.path=="/api/engine-move":
            if self.headers.get("X-Chess-Lab-Token","")!=TOKEN:return self._json({"error":"invalid pairing token"},401)
            try:
                n=int(self.headers.get("Content-Length","0")); data=json.loads(self.rfile.read(n) or b"{}")
                move=native_engine_move(str(data.get("fen","")),int(data.get("depth") or 12),data.get("allowedMoves") or [],data.get("engine","sf19-full-single"),data.get("threads",1))
                return self._json({"move":move})
            except Exception as e:return self._json({"error":str(e)},400)
        if p.path=="/api/model":
            if self.headers.get("X-Chess-Lab-Token","")!=TOKEN:return self._json({"error":"invalid pairing token"},401)
            model=load_native_model()
            return self._json({"model":model,"generation":native_generation} if model else {"model":None,"generation":native_generation})
        if p.path=="/ws" and self.headers.get("Upgrade","").lower()=="websocket": return self.websocket()
        return self.static()
    def static(self):
        rel=urlparse(self.path).path.lstrip("/") or "app.html"; target=(ROOT/rel).resolve()
        try: target.relative_to(ROOT.resolve())
        except ValueError:return self.send_error(403)
        if not target.is_file():return self.send_error(404)
        data=target.read_bytes(); types={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".wasm":"application/wasm",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon"}
        self.send_response(200);self.send_header("Content-Type",types.get(target.suffix,"application/octet-stream"));self.send_header("Cache-Control","no-store");self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data)
    def websocket(self):
        key=self.headers.get("Sec-WebSocket-Key")
        if not key:return self.send_error(400)
        accept=base64.b64encode(hashlib.sha1((key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(101,"Switching Protocols");self.send_header("Upgrade","websocket");self.send_header("Connection","Upgrade");self.send_header("Sec-WebSocket-Accept",accept);self.end_headers()
        client={"sock":self.connection,"role":"unknown"}
        with clients_lock:clients.append(client)
        try:
            ws_send(client["sock"],{"type":"hello","version":"0.1.0","state":state})
            while True:
                msg=ws_recv(client["sock"])
                if not msg:break
                if msg.get("token")!=TOKEN:
                    ws_send(client["sock"],{"type":"error","message":"invalid pairing token"});break
                typ=msg.get("type")
                if typ=="register":
                    role=msg.get("role")
                    if role not in ("compute","controller"):break
                    client["role"]=role
                    if role=="compute":state["compute"]=True
                    ws_send(client["sock"],{"type":"registered","role":role,"state":state})
                    broadcast({"type":"connection","role":role,"connected":True},exclude=client)
                elif typ=="command" and client["role"]=="controller":
                    if msg.get("command") in ("start-training","stop-training","pause-training","resume-training","checkpoint-training","request-status"):
                        command=msg.get("command");data=msg.get("data") or {}
                        if command=="start-training" and not state.get("training"):
                            if not native_available():
                                state["training"]=False;state["paused"]=False;state["phase"]="error";state["error"]="PC training worker is unavailable. Check that Node.js can be launched by the backend.";state["updated"]=time.time();broadcast({"type":"status","data":state})
                            else:
                                state["training"]=True;state["paused"]=False;state["phase"]="starting";state["error"]="";state["trainingStartedAt"]=time.time();state["game"]=0;state["totalGames"]=int(data.get("games",data.get("gamesPerGeneration",100)) or 100);state["positions"]=0;state["updates"]=0;state["totalUpdates"]=int(data.get("updates",400) or 400);state["updated"]=time.time();broadcast({"type":"status","data":state})
                                threading.Thread(target=run_native_training,args=(data,),daemon=True).start()
                        elif command=="pause-training" and state.get("training"):
                            with native_lock:
                                if native_proc and native_proc.poll() is None:
                                    native_proc.stdin.write(json.dumps({"type":"pause"})+"\\n");native_proc.stdin.flush()
                            state["paused"]=True;state["phase"]="paused"
                        elif command=="resume-training" and state.get("training"):
                            with native_lock:
                                if native_proc and native_proc.poll() is None:
                                    native_proc.stdin.write(json.dumps({"type":"resume"})+"\\n");native_proc.stdin.flush()
                            state["paused"]=False;state["phase"]="resuming"
                        elif command=="checkpoint-training":
                            with native_lock:
                                if native_proc and native_proc.poll() is None:
                                    native_proc.stdin.write(json.dumps({"type":"checkpoint"})+"\n");native_proc.stdin.flush()
                            state["phase"]="checkpoint-saving";state["updated"]=time.time()
                        elif command=="stop-training":
                            native_stop();state["training"]=False;state["paused"]=False;state["phase"]="stopping"
                        broadcast({"type":"command","command":command,"data":data},exclude=client)
                elif typ=="status" and client["role"]=="compute":
                    data=msg.get("data") or {}
                    for k in ("training","generation","game","totalGames","positions","gamesPerMinute","phase"):
                        if k in data:state[k]=data[k]
                    state["updated"]=time.time();broadcast({"type":"status","data":state},exclude=client)
        finally:
            with clients_lock:
                try: clients.remove(client)
                except ValueError: pass
            if client["role"]=="compute":
                state["compute"]=False;broadcast({"type":"connection","role":"compute","connected":False},exclude=client)

def auto_pull():
    """Fast-forward the local checkout when it has no uncommitted changes."""
    import subprocess
    try:
        dirty=subprocess.run(["git","status","--porcelain"],cwd=ROOT,capture_output=True,text=True,timeout=10)
        if dirty.returncode!=0 or dirty.stdout.strip():
            print("Auto-update skipped: local changes detected.")
            return
        result=subprocess.run(["git","pull","--ff-only"],cwd=ROOT,capture_output=True,text=True,timeout=30)
        output=(result.stdout+result.stderr).strip()
        if result.returncode==0:
            print("Auto-update: "+(output or "already up to date."))
        else:
            print("Auto-update skipped: "+(output or "git pull failed."))
    except Exception as e:
        print("Auto-update skipped: "+str(e))

if __name__=="__main__":
    auto_pull()
    threading.Thread(target=update_loop,daemon=True).start()
    tls_cert=os.environ.get("CHESS_LAB_TLS_CERT","").strip()
    tls_key=os.environ.get("CHESS_LAB_TLS_KEY","").strip()
    https_enabled=bool(tls_cert and tls_key)
    if https_enabled:
        if not Path(tls_cert).is_file() or not Path(tls_key).is_file():
            raise SystemExit("CHESS_LAB_TLS_CERT and CHESS_LAB_TLS_KEY must point to existing certificate/key files.")
    print("Chess Lab PC bridge")
    public_tunnel=start_public_https()
    print("%s://127.0.0.1:%d/"%("https" if https_enabled else "http",PORT))
    print("Pairing token: %s"%TOKEN)
    print("LAN clients can use this PC's local IP on port %d."%PORT)
    server=ThreadingHTTPServer((HOST,PORT),Handler)
    if https_enabled:
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version=ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(certfile=tls_cert,keyfile=tls_key)
        server.socket=context.wrap_socket(server.socket,server_side=True)
        print("HTTPS enabled with TLS 1.2+.")
    else:
        print("HTTPS disabled. Set CHESS_LAB_TLS_CERT and CHESS_LAB_TLS_KEY to enable it.")
    server.serve_forever()
