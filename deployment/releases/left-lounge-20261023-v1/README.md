# Left hall lounge release

Moves Mira's bar to the left, aligns two sofas with their lamps and tables on a shared rug, and places the piano in the adjacent music corner. Shared geometry moves client art, server interactions, staff routes, cat surfaces and the minimap together. Windows use one row with equal spacing; duplicate windows are removed and wall signs and lights leave the frames clear.

The release overlays the verified production host. Commit cfb20ac contains the exact production baseline and the 20 hall paths. Its source is reachable from main, while newer unrelated development stays in the main tree. The independently published Girlhub source and package are preserved as recorded in source-lock.json. Existing game packages and external pointers, payment and finance programs, environment, mounts and player data are preserved. The current source snapshot, prior client index and previous image form the single rollback set.

Use `check`, then `release` to hold the publication locks throughout build and publish. Separate `build` and `publish` remain available. Each operation rejects drift. The image must correspond to source already pushed to main. Rollback preserves databases and refuses to overwrite later releases. Source rollback must also be committed and pushed.
