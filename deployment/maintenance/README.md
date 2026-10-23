# Release history cleanup

`cleanup-release-history.py` keeps the currently healthy application and the complete immediate rollback bundle in the current release directory and its matching source backup. It verifies the rollback source archive and every rollback program byte before planning deletion. Existing application retention is rebound to these two images.

Run `plan --release <current-release> --state /opt/royal-maintenance/<operation>` first. Review its retained paths, deletion inventory and SHA-256, then run `apply` with the same arguments and `--plan-sha256 <reviewed-sha>`. Both operations hold the application and module deployment locks.

Deletion is limited to reviewed direct entries under `/opt/royal-backups` and `/opt/royal-releases`, plus unreferenced images tagged only as `royal-game`. Fresh entries, mounted subtrees, changed inventories and image references stop cleanup. There is no forced image removal, volume deletion, database restore or application restart. Docker may retain parent images and layers required by the retained releases.

The live application, configuration, external modules, database volumes, financial backup directory and other services remain outside the deletion scope. Private plans and progress stay on the server. Record the verified public result in `deployment/SERVER.md` after completion.

Local scope checks: `python3 -m unittest discover -s deployment/maintenance -p 'test_*.py'`.
