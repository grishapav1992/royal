# Cosmic Escape layout release

The release changes only `src/ui/CosmicEscapeUI.ts` and `src/ui/cosmic-guardians.css`. The composition keeps the captain, reels, results and controls together, limits the desktop board to 860 px and the control panel to 1040 px, and responds to the game container width beside chat.

Build the registered package with `npm --prefix games/cosmic-escape run build`. `module-proof.json` records the exact inputs and immutable output. No new assets, host contracts, backend code, wallet rules or migrations are required.

`public-browser.mjs --candidate` routes only this game's package requests to the reviewed local build while exercising the deployed hall, its catalogue, module loader and real game dialog. The guest hall has no network chat, so the unchanged production `installGameChat` function attaches an empty local chat dock for desktop and phone layout checks. It creates no accounts, sends no wallet writes and joins no production room. Without `--candidate`, all game resources come from production.

`recovery.mjs` checks the built module with isolated API responses: a lost operation keeps its UUID, pending storage and shared wallet lock through close/reopen and retry. It does not call production APIs.

`deploy.py` uses the reviewed publisher and both publication locks. It requires the full baseline, exact two-file source delta, package hashes and installed host contract to match, verifies the source backup, tags the previous running and prepared images, atomically changes only this game's pointer, and checks that host programs, settings, volumes, other services and all other modules remain unchanged. Its `install-manifest.json` is assembled in the release directory after the source commit is pushed. `snapshot.py` hashes private configuration without disclosing values. Never restore a database for this presentation change.

The protected server copy of `deployment/SERVER.md` and unused `server/LobbyRoom.ts.orig` remain operational exceptions to the Git baseline; all application sources and assets match after line-ending normalization. The source commit, selected version and verification outcome are recorded in the repository deployment log after publication.
