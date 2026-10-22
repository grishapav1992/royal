# Chat moderation recovery release

This release changes the host client and only `/app/dist-server/index.js`. It does not install game modules or replace dependencies, payment programs, crypto reconciliation, the bundled module baseline, external packages, the private host contract or production configuration.

Prepare the exact source against the production snapshot, validate it, commit it and push it to `origin/main` before publishing. Keep protected `deployment/SERVER.md` and historical source backups on the server. After public verification, record the source commit, running image, backup and verification results in `deployment/SERVER.md`, then commit and push that record.

The shipping directory is `/opt/royal-releases/chat-moderation-20261022-v1` and contains:

- `deploy.py` and the unchanged reviewed `snapshot.py`.
- `install-manifest.json` with `release`, `sourceCommit`, `before`, `changed`, `delta`, `serverDelta`, `helperSha256` and `snapshotSha256`.
- `source/` containing exactly the qualified source delta described by `changed`.
- `dist-delta/` containing exactly the client files described by `delta`: `index.html` and JavaScript or stylesheet bundles.
- `server-delta/index.js`, whose digest is the only entry in `serverDelta`.

The manifest shape is:

```json
{
  "release": "chat-moderation-20261022-v1",
  "sourceCommit": "<reviewed 40-character commit>",
  "before": {},
  "changed": { "server/LobbyRoom.ts": "<sha256>" },
  "delta": { "index.html": "<sha256>", "assets/index-example.js": "<sha256>" },
  "serverDelta": { "index.js": "<sha256>" },
  "helperSha256": "<sha256 of deploy.py>",
  "snapshotSha256": "<sha256 of snapshot.py>"
}
```

Run `python3 deploy.py check`, `python3 deploy.py build` and `python3 deploy.py publish`. Each operation takes both the common application publication lock and the independent-module lock. Build verifies the complete source backup and previous index, tags the previous running and prepared images, and creates a small overlay from that reviewed image. Its complete runtime inventory must equal the old inventory plus the client delta and the one backend delta. The previous image layers and runtime settings must remain unchanged.

Publish updates the reviewed sources, selects the built image and recreates only `game`. Health and full source/runtime/module/configuration checks must pass. Existing asset URLs remain available in the inherited image. The persistent database and volumes are not restored or removed.

On failure the helper checks for later source, image, program, module, configuration and service changes before restoring the previous sources, image and host index. An unreadable or missing failed game container can be recreated from the previous image; readable runtime files must match the reviewed old or new image. `python3 deploy.py rollback` uses the same guards. A manual rollback also requires committing and pushing the corresponding source restoration to `main`.

Run `python3 -m unittest discover -s deployment/releases/chat-moderation-20261022-v1 -p test_deploy.py` for isolated preservation and recovery tests. These tests never contact production.
