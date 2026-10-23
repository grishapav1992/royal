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

The shared multi-user USDT custody wallet holds the money. No separate wallet or game microservice is introduced. Only the existing HMAC-authenticated server-to-server channel can request escrow operations. The public browser APIs cannot reserve a match bank, choose a winner or request match settlement.

The payment service checks two distinct participants, whole-USDT allowed stakes, request identity, available funds, current custody confirmation and payout capacity. Both stakes reserve in a single transaction with their durable signed notifications. An account cannot fund simultaneous rooms. The available balance excludes reserved stakes, and winner capacity is protected against other credits.

Unknown funding responses retain the current match and retry the same operation. They never reset to a fresh stake. A 20-second funding deadline leads to cancellation. Cancellation writes a durable tombstone, so a delayed request cannot charge either account after cancellation. Settlement and refund are idempotent and conserve the pot: two stakes of 10 USDT produce a 19 USDT payout and 1 USDT fee. The current module defaults to a 1 USDT stake.

The existing payment worker recovers orphan matches at 150 seconds without requiring the game process. Draws and cancellations refund the original amounts without a fee. The common wallet displays combat reservations and results in its history. Actual money activation requires the compatible host and payment release with NOWPAYMENTS_COMBAT_ENABLED=true; configuration remains disabled by default.

## Scope and validation

Server validation prevents client-side changes to game rules, actor identity and payout claims. It does not establish that a player is human. A bot or macro producing legal inputs remains a separate abuse-detection problem. Browser obfuscation, hidden function names and a token visible to client JavaScript would not solve that problem.

Focused tests send forged victories, extra monetary and fighter fields, forged actors, stale matches, duplicate and out-of-order sequences, and 10,000 input packets. They verify unchanged state, server cooldowns, separate player budgets and rejection during a dropped or mismatched session. USDT integration tests use two real local service processes with synthetic provider settlements to check HMAC authorization, atomic reservation, repeated settlement, failed ledger writes, cancellation before funding, expiry after restart and signed balance reconciliation. The real host is exercised with two authenticated browser sessions, connected chat and phone controls.
