# Mortal Kombat: server authority and USDT escrow

The browser is untrusted. A player may modify local JavaScript, call the console, send raw WebSocket messages, change the page's health display or automate buttons. None of those actions is an authority for the server's fight result or payment.

## Enforced boundaries

- The common authenticated room transport supplies the session. Combat additionally verifies the server's session-to-account binding and its two-player seat list for every command. A player cannot choose another actor by adding a player or account field.
- Only four command types are recognized: input, stake, readiness and rematch. Exact field schemas reject result claims, damage, health, position, client clock, simulation delta and money fields.
- Commands bind to a server-generated current match identity. Input packets also require a strictly increasing sequence number. Replays, reordered packets and commands for previous matches cannot restore old controls or affect the next fight.
- A per-player token bucket allows 40 commands per second with a burst of 20. These are engineering limits with room for the 10 Hz input heartbeat and ordinary touch/key transitions, not measurements proving human play. Floods do not advance simulation or consume the opponent's budget. Existing WebSocket message and payload limits remain in effect.
- Fixed server simulation owns movement speed, arena bounds, jumping, reach, health, hit damage, stun, attack recovery, cooldowns, countdown and timeout. Block is only effective in the server's blocking state, never during stun or unfinished attack recovery.
- Held inputs expire after 350 ms without a new valid packet. This is a fail-safe setting, not a universal latency threshold. Disconnect immediately clears held controls. The existing 20-second reconnect policy determines forfeiture; packets from a dropped connection are rejected.
- Guard rejection counters are bounded server-side diagnostics. Invalid input is ignored rather than causing an unproven automatic financial penalty.

## Money boundary

The common games wallet holds test USDT in TRON Nile, as explicitly selected by the user. The cabinet shares the same wallet singleton and immutable PvP financial journal as the other games. Match metadata contains no independent balances. Only the existing private Unix socket accepts fund, cancel and settle commands. Public browser APIs never forward them or accept a winner.

The existing financial service checks two distinct participants, allowed whole-USDT stakes, request identity, available funds and current Nile reconciliation. Both stakes reserve in one transaction with the metadata. One account cannot fund simultaneous combat rooms. Available balance excludes the bank, so other games cannot spend reserved stakes.

Unknown funding responses retain the current match and retry the same operation. A 20-second funding deadline leads to cancellation. A durable cancellation tombstone prevents a delayed request from charging either account. Settlement and refund are idempotent and conserve the pot: two stakes of 10 USDT produce a 19 USDT payout and 1 USDT fee. The default stake is 1 USDT.

The existing Nile service sweeper recovers orphan matches at 150 seconds without requiring the game process. Draws and cancellations refund original amounts without a fee. All movements are part of the common wallet revision and financial audit. A compatible host and Nile financial service release must precede independent client package publication.

## Scope and validation

Server validation prevents client-side changes to game rules, actor identity and payout claims. It does not establish that a player is human. A bot or macro producing legal inputs remains a separate abuse-detection problem. Browser obfuscation, hidden function names and a token visible to client JavaScript would not solve that problem.

Focused tests send forged victories, extra monetary and fighter fields, forged actors, stale matches, duplicate and out-of-order sequences, and 10,000 input packets. They verify unchanged state, server cooldowns, separate player budgets and rejection during a dropped or mismatched session. Nile integration tests use synthetic reconciled deposits to check atomic reservation in the common journal, forged actors, repeated settlement, failed journal writes, cancellation before funding, expiry after restart and audited balance conservation. The real host is exercised with two authenticated browser sessions, connected chat and phone controls.
