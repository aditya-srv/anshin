# Separate Node.js room server

Optional remote host for UNO rooms (e.g. AWS EC2 **t3.micro**). The sidebar **Host room** button has a Local / Remote toggle. Local still binds a room on your LAN. Remote only connects to a Server Join URL.

## Dual mode

| Host toggle | What **Host room** does |
| --- | --- |
| Local (default) | Extension binds `RoomServer` on this machine (LAN) |
| Remote | Extension connects to the Server Join URL. No local port bind |

`anshin.serverUrl` pre-fills the Remote field. It does not switch the toggle by itself. Leave it empty to type the URL in the sidebar.

**Join room** always pastes a `ws://` / `wss://` URL that includes the room token (`?t=…`).

## Goal

| Piece | Role |
| --- | --- |
| `npm run server` | Persistent WebSocket room + game engine on the VPS |
| Extension (Local) | Host binds in-process |
| Extension (Remote) | Connect to the Server Join URL on **Host room** |
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

- `RoomServer.start({ port, bindHost, persistent: true, publicHost, publicUrl, roomToken })`
- Env:
  - `PORT` (default `3847`)
  - `BIND_HOST` (default `0.0.0.0`)
  - `PUBLIC_HOST` or `JOIN_HOST` (hostname or IPv4 only). This is the only advertised address — private LAN IPs are not added
  - `PUBLIC_URL` (optional full `ws://` or `wss://` base, including a port or path). When set, this is the only join URL and `PUBLIC_HOST` is not used for advertising
  - `ROOM_TOKEN` (optional; if unset, generated and logged once at startup). When set, startup logs the join URL with the token redacted
- `SIGINT` / `SIGTERM` → `dispose()`
- Sockets are pinged. A socket that misses a pong is closed so a dead connection cannot hold the turn
- A dropped seat is held for 20s. The same player can resume and keep their hand. Leave removes the seat immediately. If only one player is left, they win
- The current player has 45s. On expiry the server chooses red if a color is required, otherwise draws one card and passes the turn
- Someone who joins during a hand waits, then sits down when that hand returns to the lobby
- After a win, the same players stay connected, see the winner, then return to the lobby. A Local room uses these same reconnect, turn clock, and next-hand rules. On the VPS, if the host leaves the lobby but others remain, another seat is promoted. A Local host leaving the lobby closes the room
- `package.json`: `"server": "node out/server.js"`

## Extension

1. **Host room** → **Local** starts a room on this machine (join URL includes a fresh `?t=`).
2. **Host room** → **Remote** connects to the Server Join URL. The field must be a `ws://` or `wss://` URL that includes `?t=`. `anshin.serverUrl` pre-fills it.
3. **Join room** → paste the same `ws://…?t=…` address. The first player in an empty lobby is the host.

## Deploy on AWS t3.micro

```bash
# On the instance (Node 20+)
git clone <repo> && cd anshin
npm install
npm run compile
cp .env.example .env
# Edit .env: set PUBLIC_HOST to the Elastic IP or public DNS, and set ROOM_TOKEN.
npm run server
```

`npm run server` and pm2 both load `.env` from the repo root. A variable already set in the shell or by pm2 is left as-is. To keep the process up after logout:

```bash
pm2 start npm --name anshin -- run server
pm2 save
pm2 startup
```

Copy the printed **Join URL** (includes `?t=` when the token was generated). That is what you share. Players toggle **Remote** and paste it, or set `anshin.serverUrl` so the Remote field is pre-filled.

- Security group: inbound **TCP 3847** from player IPs (or wider if you accept the risk).
- `pm2 startup` (above), or a systemd unit, so the process survives logout.
- Local smoke test: `PUBLIC_HOST=127.0.0.1 npm run server`, set `anshin.serverUrl` to the printed Join URL.

## Client setup (remote)

1. Toggle **Remote** on **Host room**.
2. Paste the server Join URL (`ws://…?t=…` or `wss://…?t=…`), or set **Anshin: Server Url** so that field is filled in.
3. Host clicks **Host room**. If the lobby is empty, that player becomes host.
4. Others **Join room** with the same address.

## Later polish

- TLS / `wss://` (nginx or Caddy in front of Node)
- Multi-room / room codes
- Reconnect
