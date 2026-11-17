# Cortex Clash — gameplay bug log

Working notes. Not committed. **Status** is one of: **fixed** (changed and
retested), **open** (still to do), or **design** (a rules question, not a bug).

All fixes below are uncommitted changes in `game/ai.js`, `game/engine.js`,
`game/main.js`, `game/net.js` and `game/render.js`.

---

## Fixed this round

### B1 — Turn mode could stall forever · fixed
- **Was:** two 6s either side of a wall never moved; the match ran forever (seen in headless CPU sweeps, and possible for humans in both modes).
- **Fix (rule change):** sudden death. If nothing changes for a while (no kill, merge, drain or value change), the stall rule kicks in: real-time after 90 s of game time, turn mode after 16 s of resolve time (about 10 turns). Both castles then bleed (0.5/s real-time, 2/s turn mode) until one falls, so the healthier castle wins. A "SUDDEN DEATH" banner shows on both screens, including online.
- **Retest:** the reported deadlock ends in both modes. 0 stalled games in 400 CPU-vs-CPU sweeps (was 1–3 per 100 in turn mode).

### B2 — Power-ups about 20× rarer in turn mode · fixed
- **Was:** the spawn timer only ticked during the ~2 s resolve phase.
- **Fix (rule change):** turn mode now spawns one power-up every other turn (at the start of planning, so you can plan for it). Real-time is unchanged (every 9 s).

### B3 — Real-time pieces passed through each other · fixed
- **Was:** a flier passed through a piece that stepped into its lane mid-flight, and head-on swaps passed through each other. Turn mode collided in both cases.
- **Fix (rule change):** mid-air collisions now apply in real-time too (same cluster rule as turn mode). Arrival attacks are unchanged: in real-time an equal attacker still wins on arrival.
- **Retest:** the fly-through case collides (2 into a 3 → top 1 left). An equal swap annihilates. A 4 vs 2 head-on leaves a 2. Online host and guest show the same result.

### B4 — Turn-mode draws were common · fixed
- **Was:** 22–27% of CPU turn games ended in mutual destruction.
- **Fix (rule change):** when both sides lose on the same frame, the healthier castle wins, then the bigger surviving army. Only a dead-even split is a draw. Also fixed an AI cause: the turn planner ignored each tier's sloppiness (`noise`/`skip`), so mirrored bots played identical moves into even trades.
- **Retest:** 0 draws in 200 turn-mode CPU games.

### B5 — Pieces could freeze mid-lane through planning · fixed
- **Fix:** if resolve hits its 5 s safety cap, the remaining movement is played out at once instead of pausing until the next resolve.

### B6 — LLM model IDs · fixed (upgrade, not a broken-ID bug)
- **Was:** the roster's IDs (`claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`) are valid, still-served models, so this was never a broken-ID bug. They are a generation behind.
- **Fix:** moved to `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`. These models always think, so:
  - `max_tokens` went from 1024 to 16000 (thinking spends from it; 1024 risked empty replies).
  - `effort: 'low'` keeps replies quick.
  - A `refusal` stop reason is handled.
  - Opus and Sonnet send the server-side refusal fallback (`fallbacks: "default"` + `anthropic-beta: server-side-fallback-2026-07-01`). Haiku has no fallback.
  - The fetch timeout went from 12 s to 25 s.
- **Not verified live** (no API key here). The request bodies were checked against a mock. Worth one real match per model, plus a check that the browser CORS preflight accepts the `anthropic-beta` header.

### B7 — Scattered LLM errors could hand the side to the CPU · fixed
- **Fix:** any good response resets the error count, so only 3 *consecutive* failures fall back to CPU.
- **Retest:** 50% failure rate over 40 turns → stays an LLM. API fully down → still falls back.

### Carried over, now fixed
- **Merges above 6 lost the excess** · fixed. The merge fills to 6 and the remainder stays as a piece bumped to a free neighbouring cell. Mid-air pile-ups now keep the full net force: the strongest winner carries up to 6, the rest stays on the next-strongest (6+6 vs 2 → a 6 and a 4).
- **Shields ignored in mid-air pile-ups** · fixed. They now work like on arrival: the shielded side's shields pop and it takes no damage, and an unshielded side that hits it bursts. Both shielded → both pop, then they collide normally if still overlapping.
- **Guest's last-second order dropped** (online turn) · fixed. When the clock hits 0, the host waits up to 1.5 s for the guest's "ready". The guest auto-sends it at 0, right behind any orders still in flight, and stops taking new orders at 0. Retested with 700 ms of simulated latency: the order was applied.
- **Guest couldn't see whether the host pressed GO** · fixed. Both sides now see "OPPONENT READY" and "WAITING FOR OPPONENT…", and their own GO turns into "✓ READY".
- **Online: host kept simulating while the guest was backgrounded** · fixed. The match now pauses ("OPPONENT AWAY") until they return. Also fixed a flaw in last round's away notice: heartbeat pings from a backgrounded tab cleared the away flag. Now only a real message or the 'back' notice clears it. Retested: frozen for 2.5 s while hidden despite pings, resumed on return.

---

## Human vs human on one screen (new this round, all fixed)

Tested with emulated multi-touch (`PointerEvent`, `pointerType: 'touch'`, a separate pointer id per player).

### H1 — An ambiguous tap moved the other player's piece · fixed
- **Was:** with both players holding a selection, a tap on a cell both pieces could reach went to whichever piece was *closer* (real-time), or always to the bottom player (turn mode). Reproduced: the top player tapped (4,7) for its own 2 and the bottom player's 2 moved.
- **Fix:** the tap goes to the player who most recently pressed one of their own pieces.
- **Retest:** works in both modes and both directions.

### H2 — Split picker chips covered the cells you tap to launch · fixed
- **Was:** the fragment-size chips were drawn over the cells right next to the piece, which are exactly where big fragments land. Tapping the gold cell re-picked a chip instead of launching.
- **Fix:** the chip row is placed (up/down and sideways) to keep the *armed* size's landing cells clear. Tapping the already-armed chip where it sits on a gold cell launches to the cell beneath it.
- **Retest:** 252 armed-size checks across 39 positions × 2 players. 8 left one covered cell (small fragments from a 6 reach ~30 cells), and tapping there launches correctly. 73/73 launch taps succeeded.

### H3 — Local 2P turn mode: one GO resolved both plans · fixed
- **Was:** the single GO (bottom of the screen) resolved the turn at once, cutting off the top player mid-plan.
- **Fix:** each player gets their own GO (the top one rotated toward them). The turn resolves when both are in, or when the clock ends.

### H4 — Top player couldn't read the turn HUD · fixed
- **Was:** the countdown and order count were only drawn upright for the bottom player.
- **Fix:** the top player gets a rotated copy with their own countdown, order count and ready status.

### Checked and fine (H-vs-H)
- Two players dragging at the same time (interleaved pointer events).
- Double-tap to explode, and tap-merge, for the top player.
- The top player's SPLIT button on the rotated HUD.
- Game-over screen and REMATCH.

---

## Round 5 — multi-agent hunt, fixes and retests

A 149-agent hunt (10 headless/static areas + 2 browser lanes, every finding checked by a code-trace verifier and a reproduction verifier) produced 41 grouped findings. Fixed below; each fix has a regression test in the session scratchpad (`fixes5.js`, `local2p-fix.js`, `net-fix.js`, `llm-fix.js`), and the tests were run against the unfixed code to confirm they fail there.

**Regressions in earlier rule changes**
- **Stall timer reset by split+merge churn (RTS-3, EX-1) · fixed.** Piece count is no longer part of the progress signature, so a deadlock reaches sudden death with or without churn (90.1 s both ways; was 400 s+).
- **Tie-break rounded energy and ran after the clamp (TE-2, EX-4) · fixed.** Compares real energy (unrounded, before the clamp to 0), level within 0.001, then army value. 0.9 now beats 0.3.
- **Mid-air collision pulled in bystanders (TE-1) · fixed.** A parked piece only joins a collision if it is on the mover's lane (`onLane`); a diagonal passer beside it no longer destroys, shield-pops or drags it in. Turn-fuzz collateral kills: 0 (was non-zero).
- **Merge overflow lost when boxed in (RTS-1) · fixed.** The bumped piece now searches up to 3 cells out, so value is conserved unless the board is completely full.

**Local 2P / touch**
- Tapping an enemy piece selected it instead of attacking (LOCAL2P-01) · fixed (RTS and turn): the press is an attack when the other player holds a selection that can hit it and selected last.
- READY did not lock the plan (BHVH-3, LOCAL2P-06) · fixed: no new selections, orders, cancels or split pickers after GO; the other player is unaffected.
- Split picker was one global (LOCAL2P-04/05, BHVH-2) · fixed: the other player's own-piece presses and their GO no longer close or fire it; a player's GO closes only their own picker.
- A drag held across a resolve queued an order in the next plan (BHVH-4) · fixed (drag records carry the turn number).
- Turn-mode release off the board queued a move (LOCAL2P-03) · fixed, now cancels like real-time.
- Second finger broke the first finger's drag/selection (LOCAL2P-07) · fixed in both modes.
- GO / drag-release while paused (menu-02, BHVH-5) · fixed.
- Pause and mute buttons about 22 CSS px on a phone (BHVH-8) · enlarged to 88 logical px (about 31 CSS px) with padded hit boxes. The board is still edge-to-edge on a phone: not changed.

**Online**
- A new guest restarted a live match (NP-7, BROWSER-ONLINE-1) · fixed: the host resumes the same match and re-sends the live board.
- Host kept simulating while the guest was gone (BROWSER-ONLINE-3) · fixed: the match freezes ("MATCH PAUSED · TAP TO LEAVE") until the guest returns or the host leaves.
- Dropped connection's late close/bye/input hit the new guest (NP-4, NP-5) · fixed: handlers ignore anything that is not the live connection, and a dropped link is closed.
- Stale turn orders applied in the next turn (NET-2) · fixed: guest plan messages carry the turn number.
- Guest input dropped while host paused, but shown on the guest (NET-1, NET-3) · fixed: the guest cannot give orders or press GO while paused; orders already in flight are still accepted.
- Guest GO state carried into the next match (NP-1, NET-4, BROWSER-ONLINE-2) · fixed.
- Join screen kept the previous code (NP-2) · fixed.
- Invite link with the network library missing showed DROPPING IN forever (menu-08) · fixed.

**LLM / CPU**
- Body read could hang forever after a 200 header (llm-1) · fixed: the 25 s guard covers the whole body and rejects even if the abort is ignored.
- OpenAI refusal counted as success (llm-2) · fixed; any reply without a `moves` array is now an error for every provider.
- Turn-mode prompt said "up to 3 moves" while 8 were accepted (cpu-2) · fixed: the prompt is mode-aware.
- Stale real-time answers dropped silently (cpu-3) · now the next request tells the model how many orders were dropped, and re-plans at once if none landed. Latency itself is inherent.
- Camper split destroyed the fragment (cpu-1) · fixed in the engine: a split off an enemy castle needs a fragment of 2+.
- Any 401/403 or key-mentioning body deleted the key (llm-3, menu-06) · fixed: only 401, or a 400/403 whose body is about the key.
- Rematch skipped the key prompt (llm-4, menu-05) · fixed: `AI.restart` re-asks, and a declined prompt shows an honest "NO API KEY" CPU stand-in.
- Move cap counted invalid entries (llm-5) · fixed.
- Campers locked out of every move (cpu-4) · a siege can now be left for a clearly strong move (penalty 45 - value instead of a flat unbeatable -40).
- Split chosen before comparing the parent's whole move (cpu-5) · fixed: a split must beat the parent's best whole-piece move. CPU sweeps afterwards: real-time tier order unchanged (EASY 4, NORMAL 40, HARD 40, V.HARD 75, INHUMAN 89 bottom win %), all 900 games finish, no invariant violations.

**Render / menu**
- Guest saw CASTLE UNDER ATTACK upside down at the far end (RS-1) · fixed: the banner follows the flipped view and stays upright.
- Top player got no banner when both castles were hit together (RS-3) · fixed: one banner per attacked owner.
- vs-CPU SPLIT hit box mismatch (RS-4, latent) · fixed: no SPLIT button for an AI-controlled side.
- Blank screen when storage throws (menu-01) · fixed: all localStorage access is guarded and keys fall back to memory.
- Back gesture on the title needed one press per past match (menu-07) · fixed: one guard entry; at most one press is swallowed after a game.
- Spectator turn mode showed a GO button that did nothing (menu-03) · fixed.
- Sudden-death draw said MUTUAL DESTRUCTION (BHVH-7) · now "SUDDEN DEATH DRAW".

**Not changed**
- **Power-ups are collected only on landing (TE-3)** — a rules decision for you.
- **dragLanding fallback (RTS-5)** — behaviour kept (a forgiving drag lands on the nearest legal cell when nearer ones are claimed); the comment now says so.
- **Board frame overlaps the HUD bands by 7 px (RS-5)** — the bands are empty there; only the stale layout comments were corrected.
- **Shared-screen ambiguity** — if the top player taps an empty cell that the bottom player's selected piece can reach (and nobody else selected recently), it is attributed to the bottom player. A shared screen has no per-finger identity, so this can only be reduced, not removed.

**Real-browser verification of round 5** (touch-emulated local 2P in RTS and turn, phone viewport, two-iframe online): all 9 local and all 9 online checks passed, with no JavaScript exceptions on any frame. New minor findings from that pass, not yet fixed, are listed under Open.

## Open

- **Turn-mode difficulty tiers barely differ (new).** In real-time the tiers separate clearly (EASY lost 7–33 to HARD; NORMAL lost 6–34 to INHUMAN). In turn mode it's close to a coin flip (EASY 17–23 HARD; NORMAL 21–19 INHUMAN). The planner scores moves greedily and doesn't anticipate simultaneous enemy moves, so the tier weights matter little. Needs real AI work.
- **Only the bottom player has pause** in local 2P (icon bottom-left). Minor.
- **Online away grace is 2 minutes:** if a player closes the app while backgrounded, the opponent waits up to 2 minutes for "OPPONENT LEFT" (and the match is paused meanwhile).
- **B6** needs one live test per model (see above).
- **Hosting a new room right after leaving a connected match sometimes never connects (new, minor).** Seen twice in 6 attempts in the browser: the guest stays on CONNECTING… while the host says WAITING FOR PLAYER 2. Cancelling and recreating the room fixed it. Possibly stale PeerJS state after `leave()`; needs a look at `teardown()`/`hostRoom()` ordering.
- **A guest tap unpauses a match the host paused (new, minor).** The pause is shared with no owner, so an accidental guest touch undoes a deliberate host pause.
- **Pause/mute buttons sit about 1 CSS px from the PLAYER 1 label on a 375 px phone (new, cosmetic).** No overlap.
- **Power-up icons draw over the end-of-match text (new, cosmetic).**

## Design notes (unchanged, by design)

- **Real-time equal attacks:** an equal attacker wins on arrival (a 3 landing on a 3 survives). Turn mode annihilates both. Mid-air collisions annihilate equals in both modes.

## Rule changes to sign off on

These fixes change how the game plays. Review them before pushing:

- **Sudden death:** timings 90 s real-time / ~10 turns, drain rates 0.5/s and 2/s.
- **Mid-air collisions in real-time.**
- **Tie-break:** castle health, then army value.
- **Turn-mode power-ups:** one every other turn.
- **Merge/pile-up value is conserved.**
- **Shields work in pile-ups.**
- **Round 5 additions:** mid-air collisions only involve parked pieces on the mover's own lane; the tie-break compares real (unrounded) castle energy; a stall is judged by army value and castle energy only (splitting and merging no longer resets it); a split off an enemy castle needs a fragment of 2+; a new guest resumes a live match instead of restarting it; the host's match freezes while its opponent is gone.

## Harness notes

- Round 5 regression tests (scratchpad, ephemeral): `fixes5.js` (engine), `local2p-fix.js` (real pointer listeners in a stubbed DOM; regenerate the instrumented copy with `mkpatch.js`), `net-fix.js` (two real game realms linked by a fake PeerJS), `llm-fix.js` (mocked fetch). Copy anything worth keeping.

- Headless sims are in the session scratchpad (`h.js`, `sim.js`, `sim2.js`, `fixes.js`, `bias.js`, `tier.js`). The scratchpad has been wiped once already, so copy anything worth keeping.
- `fixes.js` holds 13 targeted rule checks, all passing.
- Browser-testing pitfalls are recorded in Claude's project memory: cross-realm objects in the iframe harness, the stale service worker, the parked rAF loop.
