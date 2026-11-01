# Цу-е-фа

Independent two-player Rock Paper Scissors module, package 1.1, host API 1, rules 2, progress 1. The matching host/backend release is required before installing this package. It uses common invitations, chat, accounts, operation UUID recovery and wallet. It creates no wallet or game service.

## Rules and privacy

For a playable local opponent, run `npm ci` and `npm run preview:tsu-e-fa`, then open `http://127.0.0.1:5194/__local/tsu-e-fa/start`. The separate preview script creates a disposable PostgreSQL database, a human account with 200 synthetic USDT and an algorithm account. The algorithm offers the first free match to three wins, accepts subsequent personal invitations with the chosen free/staked terms, and independently samples each sign uniformly before a short presentation delay. It uses only its own public PvP snapshot and the normal room protocol. Right-click/tap its avatar or use its chat-roster button to invite it again. Each visit to the start URL creates a fresh local player. The namespaced preview cookie does not replace other local stands' sessions. Type `stop` in the stand's terminal to shut down and delete its database. This script is outside the production host and does not load `.env` or change production rules.

Right-click or tap a nearby player's avatar, or use their chat-roster button, then offer a game. Distant players can be approached through the menu. The server verifies proximity on the same floor when sending and accepting personal invitations. The terms choose free play or a stake and 3, 5 or 7 wins. The opponent sees those terms before acceptance. Both clients prepare the module and open the duel in place; no walk to a shared table is required, and separate pairs may play concurrently. Conditions are immutable after creation. Accepted rules-1 invitations and matches keep two wins and the previous table flow.

One accepted stake funds the entire paid match. Free matches work with a zero balance and create no holds, wallet entries, winnings or commission. Rock beats scissors, scissors beats paper, paper beats rock. Ties repeat without another stake. Both players lock one choice per numbered round; it cannot be changed. The server reveals both only after both choices are accepted. Concurrent submissions use the round number, so the opponent's first submission does not invalidate the second submission. Old round requests cannot affect a new round. Only the player sees their own unrevealed sign.

Paid stakes use the current common wallet range, 1 to 500 USDT in increments of 0.10. The invitation displays the stake, net winner credit and house commission before acceptance.

Each round has 60 seconds for both players, without extending the deadline after the first lock. One choice at timeout wins the match; no choices means a draw, with paid stakes refunded. Existing invitation, preparation, reconnect, resignation and server-lease deadlines apply. The paid decisive pot returns 95% to the winner and 5% to the house; this is aggregate pot return, not a claimed individual probabilistic RTP. Paid cancellation and refunds return 100%. Qualification enumerates every allowed stake and settlement type, all 83 pre-round score states across the three new targets, all nine sign pairs and both submission orders. The preserved rules-1 profile covers its four score states separately.

## Feedback events

| Event | Confirmed trigger and meaning | Presentation | Recovery and accessibility |
| --- | --- | --- | --- |
| Choice locked | Server confirms own choice in this round | Chosen button marked, all signs disabled, own sign visible; opponent remains sealed | No sound, no outcome prediction; text and pressed state identify selection |
| Opponent locked | Server sends only the opponent's locked flag | Sealed card says ready, without its sign | No secret in HTML, public payload, ARIA or CSS |
| Round revealed | New confirmed last-round number | Both signs and the actual winner appear together; optional 220 ms fade in the result panel | Engineering design duration only; first mount and replay are quiet, reduced motion disables the fade |
| Match finished | Confirmed challenge settlement | Final score and winner, shared host shows the exact credited pot and commission | Never infer payment from animation; result survives close/reopen |
| Close, hidden tab or account change | Host lifecycle | Destroy subscription and markup; hidden views do not animate | No audio, timers or delayed reward callbacks owned by this module |

There is no music or sound in version 1. All meaning is readable without sound. RU/EN copy, keyboard buttons and visible focus are supported. Verification must include simultaneous submissions, secrecy, duplicate operations, saved state, timeouts, exact wallet settlement and real host with connected chat on desktop/mobile. Visual checks do not establish subjective enjoyment.

## Rules-2 verification, 31 October 2026

The full application build and finance typecheck passed. The RTP gate verified 21 current/historical profiles after reconciliation with main, including both Tsu-e-fa rules versions; the frozen legacy baseline is unchanged. Rules 2 exhaustively checks 1,494 score/sign/submission-order cases and all 4,991 paid stakes in eight settlement classes. Free play is explicitly non-wagered and its complete zero-balance match creates no financial entries.

The targeted PostgreSQL suite passed 36 server, wallet, invitation, proximity, concurrent-pair and legacy-compatibility tests. Module identity/integrity checks passed seven tests; the RTP evidence gate passed 16. Two browser tests used the real compiled host and authenticated synthetic accounts: avatar right-click to a free first-to-three match, phone tap to a first-to-five paid match, decline/refund, hidden choices, tie, exact single settlement, close/reopen, reload and English recovery. Desktop 1366x900 and phone 390x844 retain connected chat, with the three choices visible above the phone chat panel. These are technical and layout checks, not an enjoyment study. No production accounts or money were used; the feature is not deployed.

Run `npm run build`, then `npx playwright test --config=playwright.tsu-e-fa.config.ts`. The browser suite starts and stops its disposable local stand automatically.

## Historical rules-1 verification, 30 October 2026

- `npm run build`: complete host/backend and all 123 independent packages, including `tsu-e-fa` version `1.0.0-30593e03c038`.
- `npm run check:rtp`: 19 qualification profiles verified. New game: all 4 reachable pre-round scores, 9 sign pairs and both submission orders (72 cases), plus 4,991 stakes and 8 settlement classes. Existing affected PvP/combat proofs were regenerated; the frozen legacy baseline is unchanged.
- `npm run check:finance`: passed.
- PostgreSQL server/wallet compatibility run: 31 tests passed across `tsu-e-fa`, `pvp-cards`, `pvp-seats`, `pvp-virtual-wallet`, `finance/pvp-store` and `finance/nile-pvp`.
- Module contract, package integrity and host separation: 7 tests passed. RTP gate and evidence rejection: 15 tests passed.
- `npx playwright test --config=playwright.tsu-e-fa.config.ts`: real production host build and two synthetic authenticated accounts, invitation, natural walking to separate seats, readiness, hidden choice, tie, close/reopen, account refresh, reload while locked, final 2:1 result and one exact 2.09 USDT credit from two 1.10 stakes. Desktop 1366x900 and phone 390x844 preserve connected chat; phone buttons fit above it. EN recovery retains the result without replay animation.

No production accounts, money or server were used. No audio evaluation or user-enjoyment study is claimed. This feature is not deployed.
