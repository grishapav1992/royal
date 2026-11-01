# Цу-е-фа

Independent module `tsu-e-fa`, package 1.2.1, host API/rules/progress 1/3/1. Requires the matching host/backend. Shared authentication, room transport, chat, operation recovery and current virtual USDT wallet remain in the host. The module creates no separate wallet or game service. This work does not publish or restore any other game.

## Rules 3: the agreed player flow

1. Approach an available player on the same floor. Right-click/tap their avatar or press E near them. The nearest available player receives E priority; focused text input and open dialogs prevent accidental interaction. The shared player-actions modal currently offers Tsu-e-fa and can gain other actions later.
2. Send a personal invitation. It contains consent to open a duel, not consent to pay. The recipient can accept, decline or return to it later. No bank or hold exists at this stage.
3. Acceptance immediately opens the independent game window for both players, with the connected host chat. Its original flat cutout hand artwork follows the user's side-view reference: two arms enter from each lateral edge, one hand makes the sign above its own open supporting palm. Four hands total, no first-person camera.
4. The bottom menu sets one shared stake for each player. It defaults to 0.10 USDT and imports the common choices 0.10, 0.20, 0.50, 1, 2, 5, 10, 20 and 50. The whole match is always first to three wins. There is no new free-play option. Show the future pot, exact winner credit and 5% commission before consent.
5. Both press «Готово» for the same terms revision. Changing the amount resets both confirmations. Either can withdraw readiness or refuse while preparing. Only the second valid confirmation atomically funds both sides and starts the match. A failed second hold rolls back the first hold and the start transition.
6. Each round begins with up to 30 seconds to select a sign privately. Choices are immutable once confirmed. Only the owner sees their selected button; all hands remain fists until reveal, so animation cannot disclose a pending opponent sign.
7. Once both signs are locked, the server schedules «Камень, ножницы, бумага, раз, два, три». The first five words occur at 800 ms engineering intervals; the confirmed reveal and «Три» share the final server event after four seconds. These are design timings, not measured perceptual thresholds. Both signs and the score remain private until that event.
8. Rock beats scissors, scissors beats paper, paper beats rock. A tie changes no score. A brief 1600 ms result presentation precedes the next private selection. All continuations and ties belong to the original stake.
9. Three wins settle the bank exactly once. Two stakes of 0.10 produce a pot of 0.20, winner credit 0.19 and fee 0.01 USDT. Shared exact rational final settlement confirms that all common denominations pay integer cents without rounding loss. This is 95% aggregate decisive-pot return, not an individual probabilistic RTP claim.

## Refusal, timeout and recovery

| Situation | Behavior and money |
| --- | --- |
| Invitation declined, withdrawn or unanswered for 120 seconds | Close the invitation, no charge or commission. |
| Either refuses during preparation, even after one confirmation | Cancel preparation, no bank or charge. |
| Terms change or an outdated «Готово» arrives | Reset both confirmations on actual changes; reject outdated terms. Never silently accept another amount. |
| Insufficient balance or settlement capacity | Do not start; roll back both funding operations. The player can change terms or refuse. |
| Preparation takes over 180 seconds | Cancel without payment. Editing terms does not extend this deadline indefinitely. |
| One player does not choose within 30 seconds | Technical match defeat for that player; the ready opponent receives the decisive pot less the same commission. |
| Neither chooses within 30 seconds | Refund the accepted stakes without commission. |
| Player explicitly surrenders after funding | Ask for confirmation; surrender awards the match to the opponent. Closing/minimizing the host window alone does not surrender. |
| A connection drops during selection, countdown or result presentation | Pause gameplay, preserve score, own accepted sign, hidden opponent sign and remaining phase time. Offer up to 60 seconds total reconnect time per player per match, preventing repeated drops from restarting a full allowance. |
| Same account returns in time | Recover through the common room/session transport, restore the same match and shift its phase deadline by the actual paused duration. No extra debit, changed choice or replay of an already revealed round. |
| One participant exhausts reconnect time | Technical defeat and one decisive settlement. Returning late cannot undo it. |
| Both disappear and neither returns in time | Cancel and refund without commission. |
| Whole game-room server lease is lost over 15 seconds | Refund rather than award an arbitrary player. This is different from a single player's reconnect pause. |

The server owns phases, deadlines, participants and settlement. Requests use stable operation UUIDs. Public snapshots explicitly copy safe fields; no opponent secret is serialized. Countdown deadlines and paused phase state are persistent. Client clocks and animations cannot adjudicate a result.

## Feedback and accessibility

| Confirmed event | Presentation | Recovery |
| --- | --- | --- |
| Terms agreed | Exact amount, both readiness states, future net credit | A new revision clears consent; no inferred payment from a button animation. |
| Own sign accepted | Selected button pressed, buttons disabled, hand stays closed | Same sign and UUID survive reload. |
| Both signs accepted | Cutout fist rhythm and the visible Russian chant | Opponent sign remains secret; reduced motion removes the hand movement. |
| Final server beat | Both gesture poses, confirmed result and score, «Три» | Reopening a completed result is quiet. |
| Reconnect pause | Pause overlay and remaining allowance | No delayed chant or new reward on recovery. |
| Match settlement | Actual winner and exact credited amount | Wallet is authoritative, one debit per side and one final credit. |

The current chant is visual. No separate audio context, TTS, music or sound assets are introduced. Keyboard controls, visible focus, explicit readiness and surrender confirmation are available. Module timers and listeners are destroyed on close. Layout verification uses the actual Royal host with connected chat on desktop and phone, not only a fixture.

### Side-view artwork 1.2.1

The hand shapes now use a single transparent imagegen atlas matching the approved side-view concept: rounded finger anatomy, black cutout contours, warm skin tones, paper grain and burgundy/blue sleeves. Its two columns represent the players; the four rows contain rock, scissors, paper and the stationary cupped supporting palm. The SVG clips one cell per hand without resampling or duplicating the source image. The upper hands change only after the server reveal. The same artwork supplies the three choice-button illustrations. See `artwork.json` for the exact generation prompt and reference roles.

The stage reaches both side edges at its native aspect ratio. In short desktop windows the host header and stake controls compact into fewer rows so the hand proportions stay unchanged. Phone layouts use the natural scene proportions. Dark charcoal framing, cream panels and condensed headings follow the reference. The active-hand rhythm, reduced-motion setting and shared host chat remain in place. This presentation update does not change deadlines, stakes, private selections or settlement rules.

## Compatibility and qualification

New creation uses `invite`, `terms`, `duel-ready` and `unready`. Old Tsu-e-fa creation is closed. Already accepted historical rules-1 and rules-2 invitations, paid matches and free matches still recover and finish under their original terms, including the old table flow and two-win rules 1, or three/five/seven-win rules 2. Historical requests stay parseable for UUID recovery; they cannot create another old-rules match. The package retains its previous renderer for those pinned snapshots.

Rules 3 enumerates all nine pre-round score states, nine sign pairs and both submission orders. The common-stake qualification replays all nine denominations across twelve settlement classes, including cancellation, refund, both disconnect sides, surrender and selection timeout. Separate proofs preserve rules 1 and 2. Shared source changes require refreshed proofs for affected existing games; the frozen legacy baseline is unchanged. The compatibility replay under `deployment/qualifications/tsu-duel-v3` preserves 23 accepted historical game-round cases and the published wardrobe contract using isolated synthetic data, without touching production.

Run `npm run check:rtp`, `npm run build`, the PostgreSQL `tsu-duel`, `tsu-e-fa`, player-invitation and common-wallet suites, and `npx playwright test --config=playwright.tsu-e-fa.config.ts`. Qualification instructions: `npm run qualify:rtp -- --game tsu-e-fa --write-proof`, plus `--rules 1` and `--rules 2` to regenerate the historical evidence.

For a playable isolated algorithm opponent, run `npm run preview:tsu-e-fa` and open `http://127.0.0.1:5194/__local/tsu-e-fa/start`. It creates a disposable PostgreSQL cluster, a human account with 200 synthetic USDT and an algorithm using its own public PvP snapshot. The bot agrees to the chosen common stake and independently samples a sign before the chant. Type `stop` to shut down and delete the test database. The fixture loads no `.env` and changes no production accounts or money.
