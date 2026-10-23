# Mortal Kombat in Royal

The independent client package uses selected mk.js fighter frames (Sub-Zero and Kano) and arena 0 from https://github.com/mgechev/mk.js, pinned to revision 174149629e9b66f79995eaa204faf15695af43c1. Asset paths and SHA-256 hashes are in asset-provenance.json. The upstream README declares the software MIT licensed. The repository does not separately document the origin or licensing of Mortal Kombat character artwork. Confirm the necessary rights before commercial publication.

The shared Royal backend owns simulation, identity, account locks, escrow and settlement. The old mk.js peer-authoritative network controller is replaced by server simulation. There is no separate wallet or game microservice.

## Rules

- The cabinet is on floor 2, next to air hockey. Two distinct authenticated accounts approach the same cabinet in the same lobby.
- Equal stakes: 1, 2, 5, 10, 50 or 100 USDT from the shared games USDT · Nile wallet (test network). The cabinet uses the common nilePlay host singleton and existing private Nile service socket.
- Both confirm the same stake and current match. Changing the stake clears readiness.
- Both stakes reserve in one common Nile PvP journal transaction after both confirmations. The available amounts decrease and reserved USDT increases; other games cannot spend the bank. A three-second countdown follows.
- One 90-second fight, 100 health each. Movement, jumping, punch, kick and block. The server alone decides collisions, damage and the result.
- Winner receives 95% of the entire pot, including the winner's original stake. The casino fee is 5% of the pot. Two stakes of 100 pay 190, with 10 recorded as commission.
- Equal health at timeout or simultaneous knockout refunds both stakes without commission.
- Closing the game after funding is a surrender. Closing while funding cancels with a refund. An interrupted connection has 20 seconds to reconnect. If both disconnect, both stakes return.
- Escrow and settlement survive response loss and repeated calls. Unknown funding responses keep the same match and block new charges; after 20 seconds the server cancels funding. A durable cancellation tombstone blocks delayed funding requests. The existing Nile service refunds orphan escrow after its 150-second deadline, including after game-server restarts. All holds, refunds, payout and commission are replayed by the common financial audit.
- Reopening finished combat never repeats a debit or payout. A new fight creates a new server match identity and requires both readiness confirmations again.

## Feedback specification

Timings are game design parameters, not research thresholds. All health and monetary feedback follows server state.

| Event | Condition and significance | Visual and sound | Interruption and verification |
| --- | --- | --- | --- |
| Movement and attack | Accepted authoritative fighter state | mk.js frame sequence; movement and readable health bars | Held buttons release on blur, close and hidden tab. No attack controls in chat input. |
| Hit or block | Increased server hitSeq | Damage on the target health bar and short shared host hit cue; no new audio context | No replay on reconnect or initial snapshot; muted preferences respected. Check hit readability and sound alignment on speakers and headphones. |
| Fight begins | Both USDT reservations committed | Countdown 3, 2, 1, followed by combat | Closing in funding refunds; normal close after start surrenders. |
| Victory | Durable settlement confirmed | Winner name, exact payout and fee. No celebratory sound on a pending payment. | Reopen shows the saved state; no repeated reward effects or financial operations. |
| Draw or cancellation | Confirmed refund | Explicit refund message; no winner celebration | Verify exact ledger reconciliation and idempotency. |

Reduced motion freezes decorative sprite cycling. All actions and results remain readable without sound. RU and EN labels are provided. Sound quality on physical speakers, wired headphones and Bluetooth requires listening verification; automated tests do not establish pleasantness.
