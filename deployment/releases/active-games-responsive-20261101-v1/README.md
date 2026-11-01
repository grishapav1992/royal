# Active game viewport correction

The verified production catalogue contains 18 Royal games and four independent card tables. The six available PvP choices are checked through their actual connected dialog. No games are added or restored.

Thirteen packages receive presentation changes: Cosmic Escape, Caramel Carnival, Velvet Reign, Last Convoy, Nitro RUN, GIRLHUB, MEME OVERLOAD, LAST EXIT, Plinko, CR vs. Leo, Flag Battle, Dracona and Jackie Chan. Compact native scenes scroll separately from their stake, spin and autoplay controls. Short landscape panes use a control column. Dracona applies responsive CSS inside its existing iframe. Jackie keeps each difficulty choice inside its smaller scrolling console.

The projection targets source `db07429000d2116d257f0735f4916e661ce9efa8`, the shared-stakes release. Publication requires that release to be completely verified first. Every preserved compiled input and every old public module pointer must match the final installed baseline. The layout release must preserve its stakes, rules, accepted-round recovery and media. It does not publish host, backend, configuration or persistent data.

Prepare from a clean committed checkout with `release:plan`, then `release:prepare --base db07429000d2116d257f0735f4916e661ce9efa8 --modules cosmic-escape,caramel-carnival,velvet-reign,last-convoy,nitro-run,girlhub,meme-overload,last-exit,royal-plinko,cr-vs-leo,flag-battle,dracona,jackie-chan --module-projection deployment/releases/active-games-responsive-20261101-v1/module-projection.json`. Local review can use `--local`; production requires the same commit saved in main and `release:verify --github`.

`verify-layout.mjs` mounts actual packages in the connected host with chat. It checks desktop and touch contexts, horizontal overflow and complete reachability through real scroll containers. It distinguishes fixed primary controls from settings that require scrolling. `ROYAL_LAYOUT_RECOVERY=1 ONLY_GAME=studio-caramel-carnival` verifies a paid round and close/reopen only on an isolated loopback database. It never wagers against production.

The publisher holds all three locks, compares complete server inventories, binds reviewed source and immutable package bytes, verifies a complete rollback and tags the running image. Full private inventories stay on the server. A program receipt binds old and new entries, generated-identifier normalization and Dracona's CSS composition. Export only public package hashes, counts and compact results.

After publication releases its locks, canonical retention must complete with its hourly timer enabled, the host healthy and at least 5 GiB free. Record verification in SERVER.md and GitHub, then remove task-owned transport and local build outputs.

The maintenance change teaches canonical retention to validate a complete multi-package source receipt. Every changed display source, current pointer, manifest and the previous package manifests are bound to the publication proof. It retains the verified module rollback directory. The guarded installer replaces only `cleanup-release-history.py` after checking its exact previous and committed new hashes; it keeps its verified previous bytes beside the rollback. No timer, financial program or cleanup scope is disabled.
