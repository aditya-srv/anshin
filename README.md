# Anshin

Minimal VS Code extension that plays Uno or Ludo with other people on your LAN from the sidebar.

Extension id: `aditya.anshin`

## Run

1. Open this folder in VS Code or Cursor.
2. Install dependencies:

```bash
npm install
```

3. Press **F5** (or Run → Start Debugging → **Run Extension**).
4. In the Extension Development Host window, click the **Anshin** icon in the Activity Bar.
5. Use the sidebar:
   - **Host room** or paste a `ws://…?t=…` join URL and **Join room**.
   - **Host room** has a Local / Remote toggle. Local binds a LAN server (the join URL includes a room token). Remote connects to a Server Join URL and does not bind a local port. **Anshin: Server Url** (`anshin.serverUrl`) only pre-fills that Remote field (details in `server.md`).
   - After the room is up, the host picks **Uno** or **Ludo**. Uno then shows cards-each and the special-card toggle. Ludo has no extra settings. **Start game** is under that block.
   - Uno starts with two to six players. Ludo starts with two to four. The host shares the join URL either way.
   - On your turn in Uno, click a legal card to select it and click again to play it. Wilds ask for a color.
   - On your turn in Ludo, press **Roll**, then click a highlighted token when more than one can move.
   - **Draw** takes one card from the draw pile (the discard is reshuffled in when the pile runs out) and passes the turn. If nothing is left to draw, the turn passes.

## Develop

```bash
npm run compile   # one-shot TypeScript build
npm run watch     # rebuild on change
```

### compile and build

```bash
npm run build          # compile + package anshin-<version>.vsix
npm run update         # checkout latest version branch + install its .vsix
npm run update -- v0.0.10
```