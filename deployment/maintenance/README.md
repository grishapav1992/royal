# Release history cleanup

`automatic-retention.py` is the production entry point. The hourly systemd timer
discovers the healthy running image and its exact committed host release evidence
on every run. It supports complete and scoped source archives and the release's
verified full runtime inventory, instead of adopting a stale historical format.
The current host image and its complete immediate rollback bundle are retained.
Rollback still uses the original installer and its current-data compatibility
guards; cleanup never restores a database or downgrades a reward policy.

All three publication locks are held during verification and cleanup. A busy lock
exits 75 and retries after five minutes. Missing proofs, failed guards, and low
free space exit nonzero and persist the reason in
`/opt/royal-maintenance/last-result.json`; they cannot become successful skips.
Full audit plans are limited to two runs, with 24 compact older summaries.

Database dumps, financial recovery material, private settings, fresh or unfinished
work, unclassified directories and sources without GitHub preservation evidence
are retained. Program history is selected only from the two managed history roots.
Image candidates come from exact IDs recorded in release evidence, and every tag
is rechecked against all container references before removal. The slow global image
index is not required. No image is forced and no data volume is deleted.

Compact source evidence and exact image IDs survive partial cleanup in separate
ledgers. Historical source archive hashes can be reconciled from committed public
verification records. Shared source files are checked by content, so removing one
hardlink cannot invalidate its unchanged siblings. A ten-minute staging grace,
all publication locks, active-process detection and a 24-hour pending-build grace
protect ongoing work. Financial backups retain their own policy.
The preparation grace also covers uploaded manifests before an image is built.
It uses the latest preparation metadata when an older folder is reused. Relative
deployment commands are recognized through their process working directory.

OCI manifests and configuration blobs are read with digest verification. Quiet
containerd reference queries avoid size traversal, as implemented in its
[image listing](https://github.com/containerd/containerd/blob/main/cmd/ctr/commands/images/images.go).
The read-only rollback hash process is created through the
[Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.52/),
with explicit ownership and cleanup, rather than the CLI's image-inspect preflight.
Independent game source updates require their committed publication receipt and
the exact current active pointer. Their compact proofs survive history cleanup.

After every publication, once its locks are released, start
`royal-dev-app-retention.service` and verify that the last result is `completed`,
the timer is enabled, the host remains healthy, and at least five GiB is free.
Failure is unfinished release maintenance and must be resolved, rather than
recorded as a successful cleanup. Persistent business data and financial-backup
retention need their own policy; this program does not promise bounded total
usage for those stores.

`cleanup-release-history.py` keeps the currently healthy application and the complete immediate rollback bundle in the current release directory and its matching source backup. It verifies the rollback source archive and every rollback program byte before planning deletion. Existing application retention is rebound to these two images.

Run `plan --release <current-release> --state /opt/royal-maintenance/<operation>` first. Review its retained paths, deletion inventory and SHA-256, then run `apply` with the same arguments and `--plan-sha256 <reviewed-sha>`. Both operations hold the application and module deployment locks.

Deletion is limited to reviewed direct entries under `/opt/royal-backups` and `/opt/royal-releases`, plus unreferenced images tagged only as `royal-game`. Fresh entries, mounted subtrees, changed inventories and image references stop cleanup. There is no forced image removal, volume deletion, database restore or application restart. Docker may retain parent images and layers required by the retained releases.

The live application, configuration, external modules, database volumes, financial backup directory and other services remain outside the deletion scope. Private plans and progress stay on the server. Record the verified public result in `deployment/SERVER.md` after completion.

Immutable image program checks have a small operator-private cache in
`/opt/royal-maintenance/image-program-proofs`. A proof binds the exact content-addressed
image ID, SHA-256 of the hash reader and SHA-256 of the complete expected file map.
The guarded application builder records it only after a full read-only candidate
check. Older installers still work: a missing proof triggers the full isolated read.
Wrong or corrupt evidence never passes as a cache hit; unsafe permissions and
symlinks stop verification. Mutable running files and the financial publication
barrier are never accepted from this cache. History cleanup checks the running
application, configuration, services, module pointers and retained recovery files
immediately before deletion and again after deletion. Its previous adjacent third
checkpoint has been removed. Install these maintenance files through the existing
GitHub-bound installer; never rewrite the helpers inside an already published
release or its retained rollback bundle.

Local scope checks: `python3 -m unittest discover -s deployment/maintenance -p 'test_*.py'`.
