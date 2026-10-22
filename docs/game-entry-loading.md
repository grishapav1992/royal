# Opening a game

The hall prepares only the game the player selects, approaches, focuses or hovers.
Preparation fetches static files without importing game code, mounting an interface
or touching a wallet. A new choice cancels the previous background preparation.
There is one active preparation, one latest queued choice and two resource workers.
Each preparation has a 16-resource, 8 MiB transfer limit and a timeout.

Every actual opening still fetches the current `active.json` without caching.
Only validated immutable manifests are shared, keyed by both manifest URL and
SHA-256. Successful metadata uses a 16-entry LRU. One view's cancellation does not
cancel another view's shared manifest request. Integrity failures are not cached;
a retry reloads the immutable response. Open games retain their selected version.

Packages may declare an optional `preload` image list in `games/<slug>/package.json`.
Its entries are paths relative to `public/assets`, inside the declared resource
roots. The builder checks each file against the package's resource inventory and
writes `media/` paths into the manifest. Hints are optional and backward compatible;
older packages need no change. The host validates hint paths, types, count and file
membership before fetching them. Hints never contain account or saved-round data.

Native slots keep a 64 MiB LRU of decoded images, keyed by immutable module URLs.
Version changes cannot reuse stale artwork. Custom image factories in tests remain
isolated. GIRLHUB loads its intro and selected character first, then prepares album
images or new looks when used. Selection waits for the required image; failures
offer a retry and closing prevents delayed dialogs from returning. Shared wallet
locks, fresh legacy-round checks and uncertain-operation identities are unchanged.

Velvet's five portraits have a 640 x 960 rendition appropriate for their displayed
columns. Original images remain available for regeneration. Meme's Stonks image
uses lossless WebP with identical RGBA values. Regenerate the six hashed assets and
their source map with `node scripts/build-native-slot-images.mjs` and commit them.

Validation includes the full application build, package inventory and contract
checks, preparation browser tests, native asset tests, the actual hall with chat
on desktop and mobile, and uncertain-operation recovery. Public measurements must
separate walking/seating, module loading, image readiness and warm reopening.
