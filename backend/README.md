# Chess Lab PC bridge

This directory provides the first PC-hosted backend layer for Chess Lab.

Run `python3 backend/server.py` from the repository root. The server hosts the same static Chess Lab files and provides a small authenticated WebSocket bridge.

PC compute mode: open the server address normally. The browser on the PC performs the existing learner training and Stockfish WASM work, while publishing live status through the bridge.

Android controller mode: on the same Wi-Fi, open the PC address with `?controller=1`. The controller can start and stop training on the PC and receive live training status.

The bridge deliberately exposes only Chess Lab control messages. It does not expose shell commands or arbitrary filesystem operations.

GitHub Pages remains the public static deployment and browser-only fallback. A GitHub Pages HTTPS page cannot safely be treated as a direct caller of an unsecured LAN HTTP/WebSocket endpoint, so this first milestone uses the PC-hosted copy for the local Android-to-PC path. A later secure WSS/tunnel phase can add remote Pages-to-PC control without changing the training API.
