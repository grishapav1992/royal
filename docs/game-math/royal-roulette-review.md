# Royal Roulette qualification and host review

Date: 2026-10-29 (Europe/Moscow). Integration baseline: c050280.

The existing `royal-roulette` rules 1 engine is now exposed through the Royal collection. Package 1.1.0 has its own renderer, stylesheet, numbered European wheel and table. The physical twelve-seat layout, host services and backend rules remain in place. A compatible host update is required for catalogue access and the responsive viewport selector.

## Mathematical evidence

The RTP policy registers all 41 selectable bets: red, black, even, odd and straight bets on each of 0 through 36. Each is qualified at every common-wallet stake: 10, 50, 100 and 500 virtual USDT, with exact integer settlement.

The independent expected table sums to 36 stake units over 37 equally probable numbers for every selection, giving exact RTP 36/37 and house edge 1/37. Analytical bounds are identical to this exact fraction, not estimated confidence intervals. Each paid round contains one stake and one settled draw; there are no bonuses or extra paid choices. The linear integer payout also proves the same fraction for any positive integer stake.

`npm run qualify:rtp -- --game royal-roulette --write-proof` generated `qualifications/royal-roulette-v1.json`. It performed 39,196 server replay checks: 6,068 allowed-stake/outcome combinations, 12,136 unit/large-integer boundary cases and 20,992 seeded replay cases. Seeded replays cross-check server settlement; they are not used to estimate the exact RTP. The legacy mathematical baseline and historical rules were not edited.

## Verification

- `npm run check:rtp`: all 13 registered profiles verified.
- `npm run build`: type checking, all 118 independent packages, host and server builds passed.
- `npm run test:roulette`: 25 tests passed, including exact outcomes, input validation, integer money, wallet limits, transaction rollback, shared balances, request ownership, cookie changes and replay after response loss.
- Actual hall and connected chat checked at 1440 by 1000 and 390 by 844 through `playwright.roulette.config.ts`. Scenarios cover catalogue entry, number/color/parity choices, real API and database settlement, full and reduced motion, close/reopen, response loss and a still-running accepted request. The account-change scenario clears the previous result and cell highlight. Background recovery emits no repeat reaction.
- The broader catalogue/module suite passed its package contracts, byte inventories, loader boundaries and physical-seat routing checks. An existing archive test in `server-tests/royal-floor-only.test.ts` fails because the recorded `server/demoExpansion.ts` fingerprint is `ab91cf5f0d590f05132b73b34d347f044b70f852e0bc31f4602d816289c2e420`, while baseline c050280 already contains `03f439735f9c5250b0698ef96bee9eaadae2250d87ee53e639d5c6c5c52f9229`. Roulette changes neither file. This archive mismatch has not been hidden or rewritten.

The account-ownership suite had an obsolete expectation that direct HTTP deposits remained enabled, including a call to a removed client method. That subcase now checks the existing 410 rejection, unchanged balances and preservation of an independent saved Nile request. No funding or payment implementation was changed.

The UI uses the host's shared wallet and saved operation UUID. It validates the confirmed game receipt before showing its number or amounts. Close, pause, hidden-page and account changes cancel owned presentation work. The viewport adaptation leaves the host chat visible; the mobile field scrolls while the stake and confirmation controls stay visible. No new audio graph is created. Technical event checks do not establish subjective audio quality or enjoyment.

## Publication

This review covers source and local verification. No production installation or database migration was performed. Publish the exact reviewed main commit using the project's normal guarded release process, including its current production baseline and deployment record.
