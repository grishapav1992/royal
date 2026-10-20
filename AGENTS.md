# Instructions

- Never use the em dash character (Unicode U+2014) in generated text.

## Production server access

- Read deployment/SERVER.md before deploying.
- Server: root@45.192.12.242, application directory /opt/royal, Docker Compose.
- SSH identity on this computer: ~/.ssh/royal_server_ed25519. Use ssh -i "$HOME/.ssh/royal_server_ed25519" -o BatchMode=yes root@45.192.12.242.
- The private key stays outside the project. Never print or copy it into source, archives, or chat. The key is available to other local chats on this computer.
- codex.sale API key is separate: CODEX_SALE_API_KEY in the local and server .env files. Never print these files or replace the server .env with the local one. Preserve production domain settings.
- Back up source and tag the previous image before publishing. Preserve the existing game_data volume.

## Production changes and GitHub

- Every change published to the production server must also be committed and pushed to `main` in `https://github.com/grishapav1992/royal`. This applies to application releases, independent game modules, hotfixes, and rollbacks.
- Before publishing, compare the release with the current production source and preserve changes from other chats. If the release is prepared in an ignored `artifacts/` stage or directly on the server, reconcile its actual source, required assets, build configuration, and migrations into the tracked project paths. Do not push an outdated root checkout as the source of that release.
- Validate the release, commit its corresponding source, and push to `origin/main` before publishing those same sources. Include only changes belonging to the release; preserve unrelated local work. Never force-push over other changes.
- Never commit secrets, `.env` files, private keys, database contents, or production user data. Preserve production environment settings and persistent volumes.
- Record the Git commit, release or image identifier, and verification result in `deployment/SERVER.md`. Commit and push the deployment record after verification. For a rollback, record and push the source change that restores the selected version.
- A deployment is complete only when the running release corresponds to source saved in `royal`, the deployment record is pushed, and production checks pass. If GitHub synchronization fails, report the deployment as incomplete and resolve the synchronization; do not claim that the repository is up to date.
