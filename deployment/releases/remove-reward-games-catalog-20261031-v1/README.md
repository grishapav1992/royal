# Remove Royal Coins and Royal Fruits from the production catalogue

User request: remove only Royal Coins and Royal Fruits from the production game catalogue and leave all other games untouched.

Remove only the reward-slot expansion from the Royal catalogue array. Preserve physical seats, retired-round recovery, game packages, reward policies, wallet calculations and all backend programs. The host projection retains the verified universal-spins production composition, including its unpublished-main exclusions. No other game is added, removed or updated by this release.

Run test_catalogue.mjs and test_deploy.py. Use normal release:plan, release:prepare with host-projection.json, and release:verify --github against the verified production source commit. The scoped payload must bind its client files to that exact official release and every retained host input to a fresh production inventory. Publish source to GitHub main first.

The installer reuses the existing cat-purr guarded client overlay with the full universal-spins snapshot. It preserves the three shared publication locks, financial lease, disk floor, source/index backups, previous image tags, immutable old assets and recovery checks. Exact containerd OCI metadata avoids Docker layer-size traversal while preserving image configuration and parent-layer verification. Only the catalogue source, index and newly hashed client bundles may change. Other service identities, modules, backend bytes, configuration and persistent volumes must match the baseline. If another release changes the baseline, capture and review it again before retrying.

Verify the real host catalogue with connected chat at desktop and phone sizes, all public client hashes, unchanged module pointers and backend programs. Record and push the running image and verification results. Remove only task-owned temporary build material after preservation in GitHub.
