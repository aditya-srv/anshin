Suggested build order
- Extract pure game engine (shuffle, deal, legal plays, wild color, reverse/skip/+2/+4, win) — no VS Code APIs.
- In-memory room server with WebSockets + unit tests for rules.
- Host / Join UI in the sidebar (lobby → start game).
- Wire UnoViewProvider to remote state instead of mock arrays.
- Polish: reconnect, kick, spectator, chat, rematch.