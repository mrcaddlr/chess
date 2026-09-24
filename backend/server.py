#!/usr/bin/env python3
"""Chess Lab local PC bridge."""
import base64, hashlib, json, os, secrets, socket, struct, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parent.parent
HOST=os.environ.get("CHESS_LAB_HOST","0.0.0.0")
PORT=int(os.environ.get("CHESS_LAB_PORT","8787"))
TOKEN_FILE=ROOT/".chess-lab-pairing"
clients=set(); clients_lock=threading.Lock()
state={"compute":False,"training":False,"generation":0,"game":0,"totalGames":0,"positions":0,"gamesPerMinute":0,"phase":"idle","updated":time.time(),"stockfish":None,"evaluation":None}

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
native_proc=None
native_lock=threading.Lock()
native_ready=False
native_generation=0

def native_available():
    import shutil
    return bool(shutil.which("node")) and NATIVE_SCRIPT.exists()

def load_native_model():
    if NATIVE_STATE.exists():
        try:return json.loads(NATIVE_STATE.read_text())
        except Exception:return None
    return None

def save_native_model(model):
    tmp=NATIVE_STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(model,separators=(",",":")))
    tmp.replace(NATIVE_STATE)

def start_native():
    global native_proc,native_ready,native_generation
    with native_lock:
        if native_proc and native_proc.poll() is None:return True
        if not native_available():return False
        import subprocess
        native_proc=subprocess.Popen(["node",str(NATIVE_SCRIPT)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
        model=load_native_model()
        native_proc.stdin.write(json.dumps({"type":"init","brain":model})+"\n")
        native_proc.stdin.flush()
        line=native_proc.stdout.readline()
        if not line:return False
        msg=json.loads(line)
        native_ready=msg.get("type")=="ready"
        native_generation=int(msg.get("generation") or 0)
        state["stockfish"]=bool(msg.get("stockfish"))
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
            elif typ=="progress":
                for k in ("game","totalGames","positions","phase"):
                    if k in msg:state[k]=msg[k]
                state["updated"]=time.time();broadcast({"type":"status","data":state})
            elif typ=="complete":
                save_native_model(msg["brain"]);native_generation+=1
                state["generation"]=native_generation;state["training"]=False;state["phase"]="generation-complete";state["evaluation"]=msg.get("evaluation");state["stockfish"]=bool(msg.get("evaluation",{}).get("available")) if isinstance(msg.get("evaluation"),dict) else state.get("stockfish")
                state["game"]=msg.get("games",0);state["totalGames"]=msg.get("games",0);state["positions"]=msg.get("positions",0)
                state["updated"]=time.time();broadcast({"type":"status","data":state});return msg
            elif typ=="error":raise RuntimeError(msg.get("message","native trainer error"))

def run_native_training(data):
    try:native_train(data)
    except Exception as e:
        state["training"]=False;state["phase"]="error";state["error"]=str(e);state["updated"]=time.time();broadcast({"type":"status","data":state})

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
                print("Update detected, but auto-update is paused because local changes exist.")
                return
            print("Update detected on GitHub. Pulling...")
            pulled=subprocess.run(["git","pull","--ff-only"],cwd=ROOT,capture_output=True,text=True,timeout=30)
            if pulled.returncode==0:
                UPDATE_LAST=remote_sha
                print("Update pulled. Refreshing connected pages...")
                broadcast({"type":"reload","reason":"github-update","commit":remote_sha})
            else:
                print("Auto-update failed: "+(pulled.stdout+pulled.stderr).strip())
        except Exception as e:
            print("Auto-update check failed: "+str(e))

def update_loop():
    while True:
        time.sleep(5)
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
            with clients_lock: clients.discard(c)

class Handler(BaseHTTPRequestHandler):
    server_version="ChessLabBridge/0.1"
    def log_message(self,fmt,*args): pass
    def _json(self,obj,status=200):
        raw=json.dumps(obj).encode()
        self.send_response(status);self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store");self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        p=urlparse(self.path)
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
        if p.path=="/api/health": return self._json({"ok":True,"service":"chess-lab-pc-bridge","version":"0.1.0"})
        if p.path=="/api/status":
            with clients_lock: connected=len(clients)
            return self._json({**state,"connectedClients":connected,"pairingRequired":True,"nativeCompute":native_available(),"nativeRunning":bool(native_proc and native_proc.poll() is None),"generation":native_generation})
        if p.path=="/api/pairing": return self._json({"token":TOKEN})
        if p.path=="/api/model":
            if self.headers.get("X-Chess-Lab-Token","")!=TOKEN:return self._json({"error":"invalid pairing token"},401)
            model=load_native_model()
            return self._json({"model":model,"generation":native_generation} if model else {"model":None,"generation":native_generation})
        if p.path=="/ws" and self.headers.get("Upgrade","").lower()=="websocket": return self.websocket()
        return self.static()
    def static(self):
        rel=urlparse(self.path).path.lstrip("/") or "index.html"; target=(ROOT/rel).resolve()
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
        with clients_lock:clients.add(client)
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
                    if msg.get("command") in ("start-training","stop-training","pause-training","resume-training","request-status"):
                        command=msg.get("command");data=msg.get("data") or {}
                        if command=="start-training" and native_available() and not state.get("training"):
                            state["training"]=True;state["phase"]="starting";state["error"]="";state["updated"]=time.time()
                            threading.Thread(target=run_native_training,args=(data,),daemon=True).start()
                        elif command=="stop-training":
                            native_stop();state["training"]=False;state["phase"]="stopping"
                        broadcast({"type":"command","command":command,"data":data},exclude=client)
                elif typ=="status" and client["role"]=="compute":
                    data=msg.get("data") or {}
                    for k in ("training","generation","game","totalGames","positions","gamesPerMinute","phase"):
                        if k in data:state[k]=data[k]
                    state["updated"]=time.time();broadcast({"type":"status","data":state},exclude=client)
        finally:
            with clients_lock:clients.discard(client)
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
    print("Chess Lab PC bridge")
    print("Open: http://127.0.0.1:%d/"%PORT)
    print("Pairing token: %s"%TOKEN)
    print("LAN clients can use this PC's local IP on port %d."%PORT)
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
