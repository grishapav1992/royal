# Independently published games

Every existing game definition has an independent client package. The catalogue contains 118 module identities across the current and historical game families. This is a technical inventory, not a claim that the hall has 118 visible machines:

| Family | Module identities |
| --- | ---: |
| Studio games, including Forest Heart | 42 |
| Original Royal games, GitHub practice games, session games and all casino/card variants, including LAST EXIT | 62 |
| Air hockey, pool, chess, piano and Mortal Kombat | 5 |
| Durak, transfer Durak and Crazy Eights PvP | 3 |
| Breaker, Orbit, Drift and Pixel legacy arcade games | 4 |
| Luelon and Casino API Pro provider adapters | 2 |

Supported identities and host contracts are in `src/modules/GameModuleCatalog.ts`. Each `games/<slug>/` directory contains its entry, package metadata and TypeScript configuration. GIRLHUB keeps slug `girlhub` and identity `studio-afterglow`. LAST EXIT keeps identity `github-crash` and uses slug `last-exit`. CR vs. Leo keeps its production identity `original-cr-vs-leo` in package `cr-vs-leo`; Royal Plinko keeps the current «Завеса ночи» implementation and its assets. The arcade Orbit uses identity `orbit` and slug `arcade-orbit`, distinct from `studio-orbit`.

The hall keeps its existing visible cabinets, card tables, activities and recovery paths. Historical definitions are packaged without changing their retired status. Provider games remain hosted by their providers; Royal independently packages the local catalogue, launch and iframe adapter for each provider. Their remote game engines are already loaded separately.

The single Nile wallet release hides the two provider demos and the three practice tables with separate chips. Their module identities remain available for historical compatibility. New PvP packages use the optional host `pvp` context for snapshots, legal moves and operation transport. The common backend owns their rules, hidden hands, stakes and settlement. See [PvP and the shared Nile wallet](pvp.md).


## Shared services and saved rounds

Forest Heart has package `games/forest-heart/`, identity `studio-forest-heart`, host API 1, rules 1 and progress 1. It is a new Royal catalogue choice in the existing twelve physical seats. The common expansion client negotiates its rules header, validates its confirmed root history and keeps the original pending-operation UUID across recovery. The module owns its iframe, forest art, flow animation and original procedural music, using the common audio context and wallet. See [Forest Heart verification](concepts/forest-heart/verification.md).

The hall supplies host API 1 with the existing wallet, serialized operation transport, audio, reactions, language services and shared Phaser runtime. Common layout and control styles remain part of the hall design system; packages include their game-specific styles. The Mines, Flight, demo/USDT casino, Nile, USDT and crypto clients remain live host singletons. The Luelon catalogue selection and preview watcher namespace is also shared. Modules import these services through the build bridge and never construct another wallet. Server rules, account locks, payout validation, persistent sessions and balances remain in the common backend. This change adds no game servers or microservices.

Cosmic Escape, Caramel Carnival and Velvet Reign finish saved legacy rounds before switching to their current native interfaces. Closing, reconnecting, loading a new package or retrying a lost response uses the existing server session and pending-operation identity. A package change does not create a new stake operation. An open game keeps its loaded immutable version until it closes.

The seven native Studio games use server rules 2; generic Studio games, LAST EXIT and the other packages use their existing rules contract 1. GIRLHUB retains progress contract 3. The other packages use interface progress contract 1, including games with no separate cosmetic progress protocol. These metadata values describe compatibility with the host and do not migrate server data.

## Context and lifecycle

All cabinet routes use `IndependentGameUI`. A module receives an optional context for score updates, title changes or provider room callbacks. Arcade modules return start, restart, pause, resume and diagnostics commands while sharing the host's Phaser implementation. Closing destroys their own game instance.

Activities keep room membership, state snapshots and ambient piano sound in the hall coordinator. Each activity package owns its dialog content, input handlers and animation loop. State and player updates arriving during module loading are retained and delivered after mount. Closing releases held piano notes, cancels charging, removes document listeners and cancels the view's animation frame. Network sessions, physics and the common sound controls stay active in the coordinator as before. The loading dialog can also be closed before the package arrives.

The provider host owns navigation and a closeable loading dialog. The independently mounted Casino API Pro adapter owns its catalogue, status polling and iframe, and disposes them on close. Luelon uses the shared catalogue-selection service so changing a game also updates the hall's preview.

## Build and run

- Build all packages: `npm run build:modules`.
- Build one package: `npm --prefix games/caramel-carnival run build`.
- GIRLHUB remains: `npm --prefix games/girlhub run build`.
- The main `npm run build`, `npm run dev` and `npm run dev:web` prepare all packages automatically. When using only `dev:server`, run `npm run build:modules` first.

Outputs are under `module-dist/<gameId>/versions/<version>/`, with a separate `active.json` for each game. A package contains its JavaScript, stylesheet, referenced media from declared roots and SHA-256 manifest. Unused source image originals are omitted; dynamic image and audio selections retain the resources under their declared prefixes. Package-local resource URLs point at that exact immutable version, including images referenced from styles and dynamically selected audio. Shared presentation code can be bundled into several games, while wallet and transport state remain in the hall. A module owns its UI and resources; common server engines and multiplayer physics are unchanged.

The builder rejects server engines, storage and routes, host runtime implementations, additional native game interfaces, undeclared resource roots, invalid contracts and immutable version collisions. Existing pure vFair math helpers already used by client presentation are explicitly allowed and listed in build proof. Proof files in `module-build/` record dependency hashes, externalized host bridges, resources and package size. These outputs are ignored by Git; source, required assets and build scripts must be committed before any publication.

## Host baseline and independent overrides

The Docker image includes the freshly built `module-dist` baseline. The host first serves independent packages from `game-modules`, then falls back to the baseline for missing resources and games. Development uses the same route. The existing read-only Compose mount remains `/opt/royal-game-modules:/app/game-modules:ro`. Installing a package for one game does not hide the other baseline games or retained versions.

Missing package resources return JSON errors rather than the hall HTML. Active pointers are uncached; versioned assets have immutable cache headers. A new opening fetches the current pointer and checks its game identity, host compatibility and manifest digest before mounting the selected package.

Public packages are separate from application data. Private publication state lives in `/opt/royal-game-modules-state`, with the installed host's explicit contract in `host.json`. A full build generates the matching candidate `module-dist/host-contracts.json`. Review and install that contract only together with the corresponding host release, preserving any required existing contracts. The publisher does not update it automatically.

## Independent publication and rollback

Before production work, follow `deployment/SERVER.md` and `AGENTS.md`: compare against current production sources, preserve other chats' changes, commit and push the exact release sources to `origin/main`, back up source and tag the previous image. Deploying this migration initially requires a compatible host release; later compatible visual packages publish without rebuilding or restarting the host.

Upload the immutable package and reviewed publisher, then run:

`python3 scripts/game-module-release.py check --package <version-directory>`

`python3 scripts/game-module-release.py install --package <version-directory> --expected-sha <current-active-json-sha256>`

The game is inferred from its manifest. Optional `--game studio-caramel-carnival` must match that identity. Use `none` only when no external active pointer exists, including the first override of an image baseline. The publisher shares the application publication lock, validates every file and installed host contract, refuses stale pointers or version collisions, flushes copied files to disk and atomically switches only that game's `active.json`. It never changes the database, host source, other games, production environment or containers.

Rollback uses `rollback --game <gameId> --version <retained-version> --expected-sha <current-active-json-sha256>`. Omitting `--game` on rollback retains the GIRLHUB default for compatibility. Historical bytes are verified again. Retain immutable versions for already open games; never edit a published version in place. To roll back an independently installed version, its selected target must already be retained in the external publication directory.

Both new and rolled-back packages must correspond to committed and pushed sources. Record the source commit, selected module version and production verification in `deployment/SERVER.md`, then commit and push that record. Server rule changes, progress migrations and wallet changes still require a compatible common-backend release and normal database safeguards. Independent client packaging is not a runtime security boundary.

## Validation

Run `npm run test:modules` to build all packages, verify their contracts and byte inventories, check baseline/override delivery and exercise the actual modules in an isolated browser fixture. The browser scenarios cover all 111 game mounts, version pinning, loading failures, close races, shared wallet identity, uncertain-operation recovery, activity control and cleanup, arcade start/pause and provider catalogue callbacks. They do not create production accounts or stakes.

Run `python3 -m unittest discover -s scripts/tests -p test_game_module_release.py` for publication isolation, contract compatibility, content tampering, stale SHA guards, rollback and symlink protections. The existing historical `server-tests/studio-games.test.ts` still assumes 35 games and older native request contracts; its pre-existing failures are separate from this client packaging change.

The completed local migration passed the full application build, five catalogue/contract/source/bundle-boundary checks, two static-delivery checks, ten publisher checks and fifteen browser scenarios. A real offline hall opened Royal Dice, Cosmic Escape and LAST EXIT through the module loader with no JavaScript errors. The shared backend checks passed 21 activity/physics cases and eight wallet cases. One combined backend run hit a temporary pool-shutdown race; the isolated wallet suite passed all eight cases with `--test-concurrency=1`. The production publication status and verification record are maintained in `deployment/SERVER.md`. Local proof, screenshots and version fingerprints are in `artifacts/independent-game-modules/`.

## Dracona

`games/dracona/` registers `studio-dracona` with host API 1, server rules 2 and progress contract 1. The common backend owns its clustered cascades, reserve exchanges, persistent bonus and rune state. Paid starts and free continuation use the existing serialized expansion transport and shared demo wallet. Responses include only the already used entropy needed to validate the presentation. Closing and reopening preserves the server session and pending operation UUID. The module uses an iframe that follows the actual host stage size, preserving the connected chat on desktop and mobile.

## Shared cabinet platform

The first floor has 19 independent physical seats in separate collections: ten Royal cabinets on the house carpet, five GitHub cabinets on their own carpet, three Casino API PRO cabinets on the provider carpet, and one standalone Luelon demo cabinet. Entering a collection cabinet opens only its own catalogue, with search and genre filtering. Every cabinet within a collection has the same game list. Royal contains the locally authored Studio games, LAST EXIT, native Plinko and CR vs. Leo; GitHub retains the nine reworked imported games. Luelon uses its remote demo catalogue and credits separately.

Physical cabinet occupancy is independent of the selected game module. Switching games preserves the seat, connected chat and shared wallet. Closing releases only that physical seat. Reentry opens its collection again, and saved game rounds remain recoverable in every compatible seat. Source checks in the host reject launches from another collection; provider navigation approaches only a free Casino API PRO cabinet. Game definitions remain available when a game no longer has a dedicated cabinet, preserving catalogue names, rules and recovery.

Casino API Pro accepts an optional embedded provider context. The shared host owns its window and navigation, while the provider adapter rechecks configuration, wallet acknowledgement and game availability. The existing launch URL validation and iframe sandbox remain active. Switching cancels provider requests, polling and the iframe without releasing the seat. Standalone provider callbacks remain compatible. The original remote Luelon demo catalogue is outside the platform.

Existing native artwork, the small startup previews, preparation cache, latest chat implementation, server engines, payout rules and wallet transport are preserved. GitHub decoration is scoped to the current nine GitHub identities; native Plinko keeps its production design. Use the platform browser scenarios with the real host and connected chat on desktop and mobile, and verify package integrity and recovery before publication.

Mortal Kombat uses activity identity and package slug mortal-kombat on floor 2. See games/mortal-kombat/README.md for wager rules, escrow recovery, asset provenance, shared USDT · Nile integration and server anti-cheat controls (rules contract 2). It requires this compatible host/backend release before the client package can be published.
