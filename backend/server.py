#!/usr/bin/env python3
"""Chess Lab local PC bridge."""
import base64, hashlib, json, os, secrets, socket, struct, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parent.parent
HOST=os.environ.get("CHESS_LAB_HOST","0.0.0.0")
PORT=int(os.environ.get("CHESS_LAB_PORT","8787"))
TOKEN_FILE=ROOT/".chess-lab-pairing"
clients=set(); clients_lock=threading.Lock()
state={"compute":False,"training":False,"generation":0,"game":0,"totalGames":0,"positions":0,"gamesPerMinute":0,"phase":"idle","updated":time.time()}

def pairing_token():
    if TOKEN_FILE.exists(): return TOKEN_FILE.read_text().strip()
    token=secrets.token_urlsafe(18); TOKEN_FILE.write_text(token)
    try: os.chmod(TOKEN_FILE,0o600)
    except OSError: pass
    return token
TOKEN=pairing_token()

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
    def do_GET(self):
        p=urlparse(self.path)
        if p.path=="/api/health": return self._json({"ok":True,"service":"chess-lab-pc-bridge","version":"0.1.0"})
        if p.path=="/api/status":
            with clients_lock: connected=len(clients)
            return self._json({**state,"connectedClients":connected,"pairingRequired":True})
        if p.path=="/api/pairing": return self._json({"token":TOKEN})
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
                        broadcast({"type":"command","command":msg.get("command"),"data":msg.get("data") or {}},exclude=client)
                elif typ=="status" and client["role"]=="compute":
                    data=msg.get("data") or {}
                    for k in ("training","generation","game","totalGames","positions","gamesPerMinute","phase"):
                        if k in data:state[k]=data[k]
                    state["updated"]=time.time();broadcast({"type":"status","data":state},exclude=client)
        finally:
            with clients_lock:clients.discard(client)
            if client["role"]=="compute":
                state["compute"]=False;broadcast({"type":"connection","role":"compute","connected":False},exclude=client)

if __name__=="__main__":
    print("Chess Lab PC bridge")
    print("Open: http://127.0.0.1:%d/"%PORT)
    print("Pairing token: %s"%TOKEN)
    print("LAN clients can use this PC's local IP on port %d."%PORT)
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
