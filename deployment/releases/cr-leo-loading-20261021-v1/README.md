# CR vs. Leo loading

Client-only performance release. See compression.json for byte counts, lossless sprite validation and critical asset sizes. Loading tests cover real weighted progress, decode completion, shared in-flight work and prepared frames, closed-window cleanup, retry cache bypass and required-scene priority. Original PNG files, server code, financial model and dependencies remain unchanged.

The local slow/failure review server, preview entries and gallery are excluded from this release. Deployment backs up the current source and static files, tags the previous images and publishes the bounded client delta atomically without restarting the game or touching data.
