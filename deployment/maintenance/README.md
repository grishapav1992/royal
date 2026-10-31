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

Local scope checks: `python3 -m unittest discover -s deployment/maintenance -p 'test_*.py'`.
