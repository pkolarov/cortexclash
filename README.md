# Cortex Clash

Retro real-time strategy duel for two players, built as a single HTML5 canvas game.
Numbered pieces battle across a 9×13 grid: low numbers run far and fast, high
numbers hit hard. Drain the enemy castle to win.

## Play

- **`index.html`** — the full game (loads fonts/libs from CDNs). Serve the folder
  with any static server, or enable GitHub Pages on this repo and play at your
  Pages URL. Phone-first: open it on a mobile browser.
- **`cortex-clash-standalone.html`** — single self-contained file, works offline
  (online multiplayer still needs internet for matchmaking).

## Modes

- **Local battle** — two players share one phone, face to face; the top player's
  pieces and HUD are rotated toward them.
- **Online battle** — host creates a room (4-letter code / invite link with
  `#room=CODE`), guest joins. WebRTC peer-to-peer via the public PeerJS broker;
  host runs the authoritative simulation and streams state at ~15 Hz.

## Rules

- Tap your piece, tap a highlighted cell. No turns — both players act in real time.
- A piece moves `7 − value` cells per hop and deals its value in damage.
- Land on your own piece to merge (max 6); use SPLIT to divide a piece.
- Any piece parked on a castle drains it at `0.7 × value`/sec — including your
  own defenders, so save your castle and then move off.
- Power-ups spawn mid-field: **+2** permanent value, **bolt** 70% speed for 8 s,
  **shield** blocks one hit, **heart** +12 castle energy.
- Arenas: five fixed layouts plus **CHAOS** (random mirrored walls and armies).

## Code layout

| File | Role |
| --- | --- |
| `game/engine.js` | Rules + real-time simulation (no rendering) |
| `game/render.js` | Canvas renderer: board, tokens, HUD, title/lobby/join screens |
| `game/net.js` | WebRTC online play (PeerJS), state sync, host-authoritative |
| `game/main.js` | Input, screen routing, main loop |
| `game/boards.js` | Arena definitions |
| `game/sound.js` | WebAudio chiptune SFX |
| `game/tweaks-panel.jsx` | Dev-only tuning panel (inactive outside the design tool) |

No build step — plain ES5-ish JavaScript, open `index.html` and play.
