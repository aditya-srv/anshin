# Anshin

Minimal VS Code extension with a lightly interactive UNO cards demo in the sidebar.

Extension id: `aditya.anshin`

## Run

1. Open this folder in VS Code or Cursor.
2. Install dependencies:

```bash
npm install
```

3. Press **F5** (or Run → Start Debugging → **Run Extension**).
4. In the Extension Development Host window, click the **Anshin** icon in the Activity Bar.
5. Use the **UNO** sidebar:
   - Click a hand card to select it; click again to play it onto the discard pile.
   - Click **Draw** to take the next card from the fake draw pile.

No real UNO rules are enforced — this is a demo UI only.

## Develop

```bash
npm run compile   # one-shot TypeScript build
npm run watch     # rebuild on change
```
