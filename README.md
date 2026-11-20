# Anshin

Minimal VS Code extension that plays **Uno**, **Ludo**, or **Bluff** with other people on your LAN from the sidebar.

Extension id: `aditya.anshin`

## Games

| Game | Players | Notes |
| --- | --- | --- |
| Uno | 2–6 | Classic shedding; host can set cards each and special-card deal |
| Ludo | 2–4 | Dice and tokens on the board |
| Bluff | 2–4 | Cheat / BS — declare any rank, challenge the last play |

### Bluff rules

1. Host creates or joins a room the same way as Uno/Ludo, picks **Bluff**, then **Start game**.
2. A 52-card deck (no jokers) is shuffled on the server and dealt as evenly as possible.
3. On your turn, select 1–4 cards and declare **any** rank (Ace through King). The cards go face-down on the pile. Declared rank does not have to match.
4. The next player may **Call bluff!** on that play, or play their own cards (which accepts the previous claim).
5. On a challenge, the played cards are revealed. If any card mismatches the claim, the bluffer takes the whole pile; otherwise the challenger takes it. Turn continues with the seat after whoever collected.
6. Emptying your hand does not win immediately — the next player can still challenge that final play. If they play instead (or time out), you win.

Private hands stay on the server. Opponents only see card counts and public claims.

## Run

1. Open this folder in VS Code or Cursor.
2. Install dependencies:

```bash
npm install
```

3. Open Run and Debug and start **Run Extension (no debug)** (recommended).  
   Plain **F5** / **Run Extension** can fail on some Cursor/Windows setups where `localhost` prefers IPv6 (`Extension host did not start in 10 seconds`). **Ctrl+F5** or the no-debug config avoids that debugger attach bug.
4. In the Extension Development Host window, click the **Anshin** icon in the Activity Bar.

### Two-player local test (important)

The **host** often runs from F5 (workspace build). The **joiner** usually opens Anshin in a normal Cursor window, which uses the **installed** VSIX. Those must both include Bluff:

```bash
npm run build
cursor --install-extension .\anshin-0.0.12.vsix --force
```

Then **Reload Window** on the joiner’s Cursor. Lobby title should show `v0.0.12`. If the joiner still sees Uno wild cards / `Draw (undefined left)` during Bluff, they are on an old install.
5. Use the sidebar:
   - **Host room** or paste a `ws://…?t=…` join URL and **Join room**.
   - **Host room** has a Local / Remote toggle. Local binds a LAN server (the join URL includes a room token). Remote connects to a Server Join URL and does not bind a local port. **Anshin: Server Url** (`anshin.serverUrl`) only pre-fills that Remote field (details in `server.md`).
   - After the room is up, the host picks **Uno**, **Ludo**, or **Bluff**. Uno then shows cards-each and the special-card toggle. Ludo and Bluff have no extra settings. **Start game** is under that block.
   - Uno starts with two to six players. Ludo and Bluff start with two to four. The host shares the join URL either way.
   - On your turn in Uno, click a legal card to select it and click again to play it. Wilds ask for a color.
   - On your turn in Ludo, press **Roll**, then click a highlighted token when more than one can move.
   - On your turn in Bluff, select up to four cards, choose a declared rank, and press **Play cards**, press **Pass** to skip to the next player, or press **Call bluff!** to challenge the previous claim. Bluff has no turn timer.
   - **Draw** (Uno) takes one card from the draw pile (the discard is reshuffled in when the pile runs out) and passes the turn. If nothing is left to draw, the turn passes.

## Develop

```bash
npm run compile   # one-shot TypeScript build
npm run watch     # rebuild on change
npm test          # compile + unit/integration tests (room, uno, ludo, bluff)
```

### compile and build

```bash
npm run build          # compile + package anshin-<version>.vsix
npm run update         # checkout latest version branch + install its .vsix
npm run update -- v0.0.12
```
