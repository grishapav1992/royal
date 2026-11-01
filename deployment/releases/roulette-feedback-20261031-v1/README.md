# Roulette feedback 1.5 publication

Prepare a normal modules-only release for royal-roulette against the installed host source commit. Keep source receipts and exact immutable package bytes. Run test_publish.py before using publish.py.

The publisher uses all three shared locks, the full reviewed universal-spins snapshot, and the standard game-module-release.py installer. It checks the unchanged 1/1/1 contract, exact source scope, package hashes, GitHub receipt, current host and old pointer. It preserves a verified source archive, hard-linked old package and an exact running-image rollback tag. The complete source, runtime, other modules, service identities and configuration must remain unchanged outside the eight roulette paths and its new immutable package.

Docker 29 image inspection on this server stalls while calculating layer sizes. Containerd's filtered image metadata supplies the exact same manifest target for latest and the rollback tag without that traversal. The guard rejects absent, ambiguous or malformed targets; this does not change image content or relax the five GiB reserve. It does not restart Docker or host services.

Before snapshot, stage only this helper, prepared metadata, publisher, eight changed source files and the three immutable package files under /opt/royal-releases/roulette-feedback-20261031-v1. Capture the locked snapshot with `publish.py snapshot`, review the baseline and original source hashes, then write operator.json with exact payload hashes. Recheck GitHub and release:verify before installation. After publication verify public immutable bytes, wallet authorization and browser rendering, then push the deployment record. Remove task-owned payload and temporary local checkout only after verification; preserve rollback materials.
