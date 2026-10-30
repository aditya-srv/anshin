# Anshin

Minimal VS Code extension that plays UNO with other people on your LAN from the sidebar.

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
   - **Host room** or paste a `ws://` address and **Join room**.
   - The host shares the join URL and starts once two to six players are in the lobby.
   - On your turn, click a legal card to select it and click again to play it. Wilds ask for a color.
   - **Draw** takes one card from the draw pile (the discard is reshuffled in when the pile runs out) and passes the turn. If nothing is left to draw, the turn passes.

## Develop

```bash
npm run compile   # one-shot TypeScript build
npm run watch     # rebuild on change
```

### compile and build

From this extension folder:

```bash
npm install
npm run compile
npx vsce package --allow-missing-repository
```

## install in cursor

```bash
cursor --install-extension anshin-0.0.4.vsix
```