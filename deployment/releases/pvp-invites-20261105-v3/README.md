# Compact, priced player invitations

Publish only the six reviewed host/backend inputs over the actual production
host, plus twelve qualification-source receipts. The catalogue, new-round
availability, all independent packages, settings and persistent data stay fixed.
The existing Tsu-e-fa package 1.3.2-878d142cb99b is verified and used unchanged in
the local two-player stand. Existing unpriced invitations keep their original
terms and readiness flow. New invitations pin the offered stake before consent.

Capture the healthy current production inventory without publication locks,
including its matching host/backend Git origin maps. Run `configure.mjs` on that
capture. It applies only the invitation edits, preserves the other production
inputs and binds every mathematical receipt to the actual resulting sources.
Commit and push the projections and the installer before `release:plan` and
`release:prepare` with both tracked projections. Keep that prepared source commit
fixed. Fetching later release records does not require merging or rebuilding it.

Run the mandatory wallet suite and the relevant PvP tests through
`projection-loader.mjs`. After preparation, run `fetch-package.mjs` and the
two-player browser scenarios with `built.config.ts`. The stand executes the
compiled backend and host, verifies production media and uses disposable funds.
Run `release:verify -- --github`, then `prepare.mjs <before.json> <payload-dir>
<installer-commit>` to package exactly those verified bytes and helper origins.

Upload the package and invoke `deploy.py release`. Preparation, transfer and
tests hold no publication lock. The installer acquires all three locks
nonblockingly only for installation; a busy lock releases partial acquisitions
and exits 75. Keep the unchanged package for a later explicit retry. Do not
modify a published or retained installer. The guarded installer rechecks the
complete baseline, backs up sources, tags the old image, verifies the candidate
image and enters the existing fresh financial barrier before recreating game.
It preserves the current environment and game_data volume.

After publication, run `verify-public.mjs`, verify the complete running inventory,
finish automatic retention with status completed and confirm its enabled hourly
timer, healthy host and at least 5 GiB free. Record and push the image, commit and
verification in `deployment/SERVER.md`. Remove only this task's temporary files
after confirming GitHub preservation; retain any policy-blocked cleanup as an
explicit exception with its exact owner and cleanup condition.
