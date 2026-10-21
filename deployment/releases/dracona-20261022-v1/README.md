# Dracona production release

The new independent studio-dracona module uses the shared account, demo wallet, operation transport and persistent PostgreSQL bonus session. A compatible host release is required for its new game identity and rules. Existing cabinets keep their positions; Dracona is appended at 1200, 970. Only the approved fully clothed character assets are included.

The release is prepared from current origin/main and verified against all 1427 qualified production source files. The protected server deployment/SERVER.md remains its baseline snapshot. Live settings, the game_data volume, other services, existing independent overrides and old static URLs are preserved. No production test account or wager is required for verification.

Local validation and module proof are recorded beside this file. The source commit is pushed before publish. The reviewed deploy.py uses shared publication locks, verified source and static backups, guarded image switching and a rollback that preserves current database contents. The final published record is added after public verification.

Published source commit: 9fe42339b28291d51cb5c66e0acbfa46ffe59a7f. Image, backup and verification identifiers are in verification.json. Public HTTP checks can be repeated with `python3 verify-public.py <absolute-release-work-directory>` using its retained shipping/install-manifest.json and proof directory. Temporary transport and build copies were removed only after exact digest validation; prebuilt payload and recovery backups remain on the server.
