# Third-party game code

Royal includes adapted code from these Apache License 2.0 projects. Changes connect the games to Royal's demo wallet and account system, and adapt controls and layouts for individual cabinets.

## EZSlotsJS

- Repository: https://github.com/Botman64/EZSlotsJS
- Upstream commit: `321a8ee043b1b378025c58c35ed273c526c0ea7f`
- Creator: Botman64
- Preserved license: `public/licenses/ezslots/LICENSE.txt`
- Preserved upstream notice: `public/licenses/ezslots/NOTICE.txt`
- Adapted display code: `src/vendor/ezslots`

## vFair Games

- Repository: https://github.com/vfairgames/vfair-games
- Upstream commit: `ccdb1b2f8bbfbe6249e36579e11523e6d1ed7706`
- Preserved license: `public/licenses/vfair/LICENSE.txt`
- Adapted game mathematics: `server/games/vfair`
- Royal integration: `src/shared/originalGames.ts`, `src/ui/OriginalGames.ts`

No upstream deployment credentials, sample accounts or third-party wallet backend are included. Royal uses its existing account and demo balance system.

## Room 03: card and dice practice games

These five MIT-licensed projects are bundled locally. Each table uses separate, ephemeral practice chips. Original source snapshots are retained under `src/vendor/github/<game>/upstream`; adapted files live beside them. Repository URLs, pinned revisions, preserved license paths and modification notes are also distributed in `public/licenses/github/games.json`.

### Kusnierewicz/Blackjack-game-in-JS

- Repository: https://github.com/Kusnierewicz/Blackjack-game-in-JS
- Upstream commit: `710584b2e793570f0b2bf1495027c0a777e86120`
- Used source: `21game.js`
- Preserved license: `public/licenses/github/blackjack/LICENSE.txt`
- Adaptation: Card scoring and ace adjustment ported to TypeScript; Royal practice UI; no split/double.

### benjaminrathelot/javascript-poker-engine

- Repository: https://github.com/benjaminrathelot/javascript-poker-engine
- Upstream commit: `23ef811701a650201db8d22b3d47a90d25a456d3`
- Used source: `PokerEngine.js`
- Preserved license: `public/licenses/github/poker/LICENSE.txt`
- Adaptation: ES module wrapper and declarations for upstream implicit globals; best-five evaluation and complete kicker corrections; simplified solo always-call bot.

### open-baccarat/open-baccarat

- Repository: https://github.com/open-baccarat/open-baccarat
- Upstream commit: `e04ffbbddea27d320fbd9fd9451963876384ca0a`
- Used source: `src/lib/game/rules.ts, src/lib/game/constants.ts`
- Preserved license: `public/licenses/github/baccarat/LICENSE.txt`
- Adaptation: Rules retained; imports adapted to local types; Royal practice stakes and eight-deck shuffled shoe.

### BeFiveINFO/Lucky-Five-Video-Poker

- Repository: https://github.com/BeFiveINFO/Lucky-Five-Video-Poker
- Upstream commit: `ad4c97058f5fbd1ca670a425d13afa0d78b298e3`
- Used source: `php/PlayingCardDeck.php`
- Preserved license: `public/licenses/github/video-poker/LICENSE.txt`
- Adaptation: 53-card joker deck and paytable ported to TypeScript; full-house and wildcard evaluation corrected; PHP credits replaced by ephemeral practice chips.

### wschmrdr/crapsengine

- Repository: https://github.com/wschmrdr/crapsengine
- Upstream commit: `2e31cfd07347b942894d1e69fbafd048759e7dab`
- Used source: `crapsengine.js`
- Preserved license: `public/licenses/github/craps/LICENSE.txt`
- Adaptation: Global export replaced by isolated ES module; Pass Line, Field and Any Seven selected; supplied cryptographic dice rolls and practice net-payout accounting.

### Playing-card artwork

The 52 cards, joker and card back are bundled from Lucky-Five-Video-Poker. Its included vector-playing-cards README attributes the original images to Byron Knoll and releases the images into the public domain, with an optional WTFPL license where public domain is not recognized. The original notice is retained at `public/assets/github-cards/README.md`.

## Room 03: Rush casino wagering games

- Repository: https://github.com/vafc21/Rush
- Upstream commit: `bc55199db43cdae829b5c001de15afb2bbe13ff6`
- License: MIT, preserved in `public/licenses/github/hilo/LICENSE.txt` and `public/licenses/github/dragontower/LICENSE.txt`.
- Source snapshots (comment punctuation normalized to the project convention): `src/vendor/github/hilo/upstream/hilo.ts`, `src/vendor/github/dragontower/upstream/dragontower.ts`.
- Adapted math: `server/games/rush/hilo.ts` and `server/games/rush/dragontower.ts`.
- Adaptation: Royal UI, server-generated persistent hidden outcomes, exact integer payouts rounded down, idempotent operations, common demo wallet and existing mainnet USDT journal. Hi-Lo settles automatically after two correct guesses to bound the reserved liability. Dragon Tower retains nine rows and the original three difficulties. Future cards and dragons stay server-side until revealed. No Rush credentials, wallet code, deployment configuration, analytics or third-party backend are included.

## First-floor casino expansion, demo wallet

- Diamonds and Crash reuse vafc21/Rush at the commit above. Math is in `server/games/rush/diamonds.ts` and `crash.ts`; MIT is preserved in `public/licenses/github/hilo/LICENSE.txt`. Diamonds retains the 77.61711034% paytable for demo testing. Crash replaces the upstream financial handlers with Royal atomic settlement, private future outcomes, server time and a 100x cap.
- Nine card engines reuse https://github.com/yuta-yoshinaga/go_trumpcards at `055be77a3f19485c283505a0b0b9816f5102b2b9`: Three Card Poker, Caribbean Stud, Let It Ride, Ultimate Texas Hold'em, Casino War, Red Dog, Pai Gow, Dragon Tiger and Deuces Wild. Selected files are in `server/card-engine/internal/domain`; MIT is preserved in `server/card-engine/LICENSE` and `public/licenses/github/card-engine/LICENSE.txt`. The exact selection and adaptations are recorded in `public/licenses/github/card-engine.json`.
- Adaptations: cryptographic shuffle, credited Pair Plus wins on fold, immutable dealt-card logs, isolated evaluation of server-owned snapshots and normalized rule-chip arithmetic. Royal owns the demo wallet, all debits, refunds, payouts, account binding and idempotency. Practice refill and arbitrary balances are not exposed. Pai Gow uses normalized stakes to retain exact 5% commission. Deuces Wild retains the Full Pay table on demo money. Caribbean Jackpot and Dragon Tiger Tie side bets are disabled.
- Card screens use Royal text rendering. Upstream GUI, artwork, accounts, sessions, wallets, publisher logos and deployment configuration are not imported. Descriptive correspondence to the original games is retained here; this integration does not represent publisher endorsement or grant commercial game-name rights.
- Sic Bo Big/Small rules are adapted from https://github.com/BornToBuildGame/ultimate-game-server at `47d0b309070112b5363452439276958b17e1816b`, `examples/taixiu/match_handler.go`. MIT is preserved in `public/licenses/github/sic-bo/LICENSE.txt`. Royal implements cryptographic dice, persistent history and atomic single-player payouts; the external wallet and multiplayer match runtime are not included.

## Fourteen additional casino variants, demo wallet

The same pinned MIT go_trumpcards source supplies Mississippi Stud, Four Card Poker, Crazy 4 Poker, High Card Flush, Texas Hold’em Bonus, Oasis Poker, Russian Poker, Caribbean Draw, Spanish 21, Double Exposure Blackjack, Blackjack Switch, Free Bet Blackjack, Three Card Rummy and Andar Bahar. Attribution and selected file hashes remain in public/licenses/github/card-engine.json. Royal adapters retain the upstream tables with optional side bets disabled, expose legal actions and visible cards only, preserve multihand and exchange snapshots, and charge every additional wager through the atomic demo wallet. Crazy 4 and Free Bet settle individual rounds independently of the practice bankroll. Andar Bahar debits its stake before showing the key card and never charges again when the side is chosen. Free Bet actions are funded by the game rules and never debit the player. No real-money game handlers are enabled by this release.

## Royal casino variants, October 2026

Six Royal variants adapt the existing vFair Dice, Plinko, Limbo and Mines foundations and Rush Diamonds foundation. Exact-sum Sic Bo uses the already available three-dice game. Royal adds new betting choices, split-stake settlement, the 16-cell vault, probability-derived paytables and original SVG/CSS artwork. Existing upstream commits and licenses remain unchanged. See docs/casino-variants.md for the changed rules and settlement details.

Six further Royal variants use the existing Keno, Fruits, Hi-Lo, Dragon Tower, Dragon Tiger and Casino War foundations. Royal supplies the 20-number ticket, color sequence, paired-key ladder, independent slot lines, rank-gap bets and two-front rules, with original SVG/CSS presentation and probability-derived payouts. Fruits retains its existing symbol weights and paytable; card variants use Royal's server-owned deck snapshots. The pinned vFair, EZSlotsJS, Rush and go_trumpcards notices and licenses remain unchanged. All six use the atomic demo wallet and expose only public round state. See docs/casino-variants.md.

Six additional Royal variants provide Plinko target regions, three-card combination bets, a three-card 21 target, selected-gem collections, paired Mines reveals and an adaptive dice series. They reuse the existing licensed visual and game foundations, while their probability calculations, server snapshots, wager choices and SVG/CSS presentation are Royal additions. The previously pinned upstream licenses and original game rules remain unchanged. See docs/casino-batch-variants.md for the six new rules and independent mathematical checks.
