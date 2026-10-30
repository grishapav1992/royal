# PvP and the shared Nile wallet

The only player-facing currency is test USDT on TRON Nile. Native slots, persistent casino sessions and PvP use the existing Nile play journal. No demo balance is imported or converted into USDT. Separate demo wallet controls, provider demos and the three client-only practice card tables are hidden. Historical definitions and data remain intact. Mainnet and withdrawal behavior is unchanged and is not enabled by this release.

## Player flow

The header's `Поединки` button supports a personal invitation to an available player in the same room or an open table. Air hockey, pool, chess, podkidnoy Durak, perevodnoy Durak, Crazy Eights and Tsu-e-fa support exactly two players. Poker is excluded.

Tsu-e-fa rules 2 offers direct invitations between nearby players on the same floor. Right-click, left-click or tap the avatar, or select the player's button in the chat roster. A player can walk closer from that menu. The invitation chooses free play or a shared-wallet stake and a target of 3, 5 or 7 wins. The recipient sees the exact terms and can accept or decline. Both packages load before play starts, in place, without a reserved physical table. Separate pairs can play concurrently. Free matches create no financial hold, journal entry, payout or commission, including with a zero balance. Paid matches reserve one stake per player for the whole match and pay the decisive pot less 5%. Terms cannot change after the invitation. Accepted rules-1 invitations and matches retain their original two-win rules and physical-table flow.

Choices are final, server-private and revealed together. A tie starts another round without another stake. Each round gives both players 60 seconds; one submitted choice wins on timeout, and no choices ends in a draw, refunding paid stakes. The independent client and matching common host/backend have to be released together. See [module rules](../games/tsu-e-fa/README.md). This feature is not deployed.

The creator's stake is reserved immediately. Acceptance reserves the second stake and the physical table. Both avatars walk through the existing floor navigation and stairs to different walkable seats. Each player confirms readiness at their own seat after the client package loads. There is no teleport. Closing a playing table preserves the match; `Мой поединок` reopens it. A new match requires a new invitation and stake.

Stakes range from 1 to 500 USDT in increments of 0.01. The casino receives 5% of the entire pot. Two stakes of 50 produce a pot of 100, a winner credit of 95 and a house credit of 5. Accounting uses integer micro-USDT, including fractional fees. Draws, cancellation before play, expired invitations and lost game-server state refund every reserved stake without commission.

Invitations expire after 120 seconds, arrival after 180 seconds, and disconnected players have 60 seconds to reconnect. Card turns and idle pool turns have a 60-second limit. Chess retains its existing 15-minute server clocks. A game-room lease lost for more than 15 seconds cancels a playing match with a refund; physics state is not reconstructed after a server restart.

## Server ownership and persistence

`server/pvp/store.ts` persists match state, private card hands, revisions and operation UUIDs in the same PostgreSQL schema as the Nile journal. Game commands and money settlement commit in one transaction. The trusted room bridge supplies authenticated account identities, presence and proximity. A client cannot select a winner, another account or a payout. Public card snapshots contain only the owner's hand, the visible table, opponent card counts and legal moves.

`server/finance/pvp-money.ts` records balanced hold, refund and settlement events. Each match has separate escrow entries. The immutable journal auditor replays them, validates bound owners and rejects duplicate or inconsistent settlement. Retries use the original request UUID, so an uncertain response cannot create a second stake.

`/api/game-wallet` authenticates the session and account header, checks origin and forwards existing native-game commands through the private Nile play socket. `NileGameRuntime` runs existing server engines inside the financial transaction. Their old cents tables are a projection of the current Nile balance, not an independent source of money. Changes and payout coverage are posted to the journal atomically; insufficient house coverage rejects before RNG. Micro-unit dust survives cents-based native rounds. Old cosmetic progress imports once without its demo balance. `/api/demo-wallet` returns 410.

The financial service now bundles both current and legacy Go card rule engines for native casino sessions. Publish the compatible common host and Nile financial service together. Independently installed old game packages must also be checked against this release because their UI can retain old wallet labels. Follow `AGENTS.md` and `deployment/SERVER.md` before publication. This local implementation has not been deployed.

## Independent card modules and rules

`games/durak`, `games/transfer-durak` and `games/crazy-eights` each have an entry, package metadata and TypeScript configuration. They use host API 1 and the shared module loader, chat, authentication and wallet.

Durak uses 36 cards, six-card hands, bottom trump, legal throw-ins and a maximum of six attacking cards bounded by the defender's hand. Transfer requires matching ranks, no defended cards and enough cards in the next defender's hand. No trump-six exchange is offered. Crazy Eights uses 52 cards, seven-card hands, wild eights with explicit suit choice, one draw per turn and a pass only when no legal play remains. The stock is reshuffled from the discard except its top card. A blocked game is a draw.

Rule references: [Podkidnoy Durak](https://www.pagat.com/beating/podkidnoy_durak.html), [Perevodnoy Durak](https://www.pagat.com/beating/perevodnoy_durak.html), [Crazy Eights](https://www.pagat.com/eights/crazy8s.html). The exact table variant is displayed inside each module.

## Local verification

Build with `npm run build`. Start an isolated synthetic stand with `node --import tsx scripts/pvp-local.ts` and open `http://127.0.0.1:5191`. It creates disposable PostgreSQL, account and token fixtures. The two accounts are `pvp-local-a@example.test` and `pvp-local-b@example.test`, password `test-password!`. Use `127.0.0.1` and `localhost` in separate browser tabs to isolate their cookies. Stop by typing `stop` in its terminal. No production RPC, funds or user data are used.

Targeted checks:

```text
npm run check:finance
node --import tsx scripts/database-test.ts --import tsx --test server-tests/pvp-cards.test.ts server-tests/pvp-seats.test.ts server-tests/nile-play.test.ts server-tests/finance/nile-pvp.test.ts server-tests/finance/pvp-store.test.ts server-tests/finance/nile-native-games.test.ts
node --import tsx --test server-tests/chess.test.ts server-tests/hockey.test.ts server-tests/independent-modules.test.ts server-tests/game-module-assets.test.ts
```

The 25 targeted money, privacy, card conservation, concurrency, recovery and seat checks passed, as did 13 existing chess and hockey checks. A broad finance run passed its 151 assertions but reported a Windows temporary-directory cleanup lock for the deposits file; its isolated rerun passed all 15 checks. Actual two-account host checks covered personal and public invitations, natural walking across floors, separate readiness, hidden hands, taking/drawing/suit changes, reload recovery, close/reopen, surrender and exact 95/5 settlement. A real Royal Fruits spin reduced the synthetic wallet from 200 to 190 USDT, and the PvP panel immediately displayed the same 190. Tower session recovery and idempotent cashout also passed. Desktop 1280x720 and phone 390x844 were checked with connected chat. Local screenshots are under ignored `artifacts/pvp/`.
