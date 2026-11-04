# Flag contact level

The production module is `2.1.2-1d07daea0fa9`, from application source
`88a99af8c49ac43530c2fb9ae93a8abb4576c60d`. Its manifest SHA-256 is
`36f6fb415cfadba002e1e33b9363d3b135b0a4c8a714e47d2d5cd5daaeb17854`.
Collision gain changed from 0.065 to 0.16. The compiled program comparison
confirmed that only this gain and versioned resource URLs differ from the
previous production module. Timing, sound design, mathematics and catalogue
availability retain their reviewed production inputs.

The artifact was prepared once against manual-stakes source 64275fe, then
verified without rebuilding against the completed player-recovery host 97d9eac.
All module inputs matched that production inventory except the three reviewed
source changes. `release:verify -- --github` passed at the fixed application
commit immediately before installation.

Installer source `1a87fd4c8dfee952ba9e6bc7f0f3a641534a57c8` is separately
preserved in main. `repack-installer.mjs` binds its Git bytes and provenance to
the unchanged artifact. Preparation uses no production locks. The installer
acquires all three locks nonblockingly, closes partial acquisitions on failure,
returns 75 for contention and rechecks the complete actual server before mutation.
It saves a verified source archive, old module and exact image rollback tag.
No running, published or retained rollback helper was modified.

Sixteen audio/physics tests, nineteen common-wallet tests, eight Linux publisher
tests and thirteen common preparation-lock tests passed. Desktop and mobile
real-host tests with connected chat covered contact playback, skip, lost-reply
UUID recovery and close/reopen without extra debits. Physical device listening
and acoustic synchronization were not assessed. The headless timing diagnostic
does not prove physical sound latency.

Public checks verified the pointer, manifest, all fifty package resources,
five API boundaries and two guest browser sizes. No production test accounts,
wagers or messages were created. The installer preserved the host, backend,
other modules and services, without restart or database changes.

See `verification.json` for the publication and mandatory maintenance result,
and `prepared-validation.json` for measured preparation limits. The original
transport archive contains preliminary metadata; reuse the verified artifact
with fresh installation bindings rather than restoring archived operator data.
