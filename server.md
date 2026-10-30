# Separate Node.js room server

Optional remote host for UNO rooms (e.g. AWS EC2 **t3.micro**). Local in-extension hosting still works when `anshin.serverUrl` is empty.

## Dual mode

| `anshin.serverUrl` | **Host room** |
| --- | --- |
| empty (default) | Extension binds `RoomServer` locally (LAN), same as before |
| set (e.g. join URL from server logs) | Extension connects only — no local port bind |

**Join room** always pastes a `ws://` / `wss://` URL that includes the room token (`?t=…`).

## Goal

| Piece | Role |
| --- | --- |
| `npm run server` | Persistent WebSocket room + game engine on the VPS |
| Extension (local) | Host binds in-process when `anshin.serverUrl` is empty |
| Extension (remote) | Connect to `anshin.serverUrl` on **Host room** |
| Join | Others paste the same `ws://…?t=…` URL |

## Why this shape

- Engine / protocol / `RoomServer` already have no VS Code APIs — they can run in a plain Node process.
- t3.micro (1 vCPU, 1 GB) is enough for a single-room WebSocket game.
- EC2 private NICs (`172.31.x`) are **not** reachable from the internet — advertise `PUBLIC_HOST` (Elastic IP / public DNS).

## Access control (until TLS)

- Every room has a **room token**. Join URLs look like `ws://HOST:3847/?t=<token>`.
- The WebSocket upgrade must present matching `t`; wrong/missing token is closed (`4001`).
- Also: idle join timeout (~5s), max 8 sockets, ~20 messages/sec per socket, non-upgrade HTTP → `404`.
- Security group + the secret URL are the gate until you put TLS/`wss` in front.

## Server (`src/server.ts`)

- `RoomServer.start({ port, bindHost, persistent: true, publicHost, roomToken })`
- Env:
  - `PORT` (default `3847`)
  - `BIND_HOST` (default `0.0.0.0`)
  - `PUBLIC_HOST` or `JOIN_HOST` (hostname or IPv4 only)
  - `ROOM_TOKEN` (optional; if unset, generated and logged once at startup)
- `SIGINT` / `SIGTERM` → `dispose()`
- Persistent room: after game end or mid-game disconnect, reset to an empty lobby; in lobby, if the host leaves but others remain, promote another seat to host
- Join URLs prefer `PUBLIC_HOST`, then LAN IPs, always with `?t=`
- `package.json`: `"server": "node out/server.js"`

## Extension

1. Setting `anshin.serverUrl` (default `""`):
   - empty → **Host room** starts local `RoomServer` (join URL includes a fresh `?t=`)
   - set → **Host room** connects `RoomClient` to that full URL (must include `?t=` from the server’s printed Join URL)
2. **Join room** → paste the same `ws://…?t=…` address

## Deploy on AWS t3.micro

```bash
# On the instance (Node 20+)
git clone <repo> && cd terminal_manager
npm install
npm run compile

export PUBLIC_HOST=YOUR_ELASTIC_IP_OR_DNS
export PORT=3847
# optional stable secret:
# export ROOM_TOKEN=your-long-random-hex
# optional: export BIND_HOST=0.0.0.0
npm run server
```

Copy the printed **Join URL** (includes `?t=`). That is what you share and what you put in `anshin.serverUrl`.

- Security group: inbound **TCP 3847** from player IPs (or wider if you accept the risk).
- Optional: `pm2` / systemd so the process survives logout.
- Local smoke test: `PUBLIC_HOST=127.0.0.1 npm run server`, set `anshin.serverUrl` to the printed Join URL.

## Client setup (remote)

1. Set **Anshin: Server Url** to the server’s Join URL (`ws://…?t=…`).
2. Host clicks **Host room**; share that URL.
3. Others **Join room** with the same address.

## Later polish

- TLS / `wss://` (nginx or Caddy in front of Node)
- Multi-room / room codes
- Reconnect
