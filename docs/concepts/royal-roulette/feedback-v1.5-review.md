# Roulette feedback 1.5 review

Date: 2026-10-31, Europe/Moscow. Local implementation and verification, not a production deployment record.

## Result

The existing European roulette package now uses exponential rolling drag, a guided descent and six shared contact accents with shrinking ballistic flights. The final pose remains aligned with the confirmed server pocket. Wheel velocity decreases monotonically; ball velocity includes contact sway. The shadow follows the height of the ball. Original sounds use lower material resonances, rounded transients and quieter continuous beds and result cues.

API, rules and progress contracts remain 1/1/1. Package version is 1.5.0. No server mathematics, stake, RNG, qualification evidence or wallet implementation changed. The independent module build passed its qualification and host-bridge checks.

## Verification evidence

- `npm run check:rtp`: 26 verified policies; the 114 legacy unqualified entries remain unchanged.
- `npm run test:roulette`: 36 passed, including exact 36/37 RTP, integer settlement, wallet replay, reservation limits, account ownership, module identity, all 37 landing alignments, contact timing and sample bounds.
- Focused motion/audio tests after final gain adjustment: 11 passed. Covers 650 ms, 5 s and 30 s reply delays, rim friction, numerical angular derivatives and shrinking flight heights/durations.
- TypeScript check for `games/royal-roulette/tsconfig.json`: passed.
- Independent module: `1.5.0-7a8c04b40048`, two packaged files, compatible shared host contract.
- `npm run test:roulette:ui`: 8 passed. The prepared full-release test was skipped because this task did not prepare a common host/backend release.
- Actual hall, Chrome: 1440 by 1000, 1280 by 720, and 390 by 844 layouts with visible chat and spin controls. Screenshots reviewed. The recorded spin and trajectory diagnostics were inspected separately from audio signal checks.
- Browser scenarios: server receipt matches displayed number; result waits for settling; lost accepted response retries its original UUID; close/reopen and account change; reduced motion; hidden page; mute, zero volume and unmute without stale rolling; blocked audio unlock; shared context remains running after module disposal.
- Offline stereo render at 44.1 kHz, shared output gain 0.35: peak 0.0447092, RMS 0.00561332, DC 0.000013966, maximum sample step 0.00699310, silent final tail. Maximum 15 owned voices, zero skipped cues and zero sources/graph owners after disposal. All modeled peak-alignment errors were 0 ms on the ideal offline clock, which does not measure speaker or Bluetooth latency.

The original browser expectation allowed only 5 seconds for a complete spin. Since the revised minimum launch plus landing is 5050 ms, the settlement assertion now derives its budget from those durations with a 2500 ms scheduling margin. The first run identified that test-only deadline; the corrected full run passed.

## Limits

Warmer and less fatiguing audio is the design goal. No participant comparison or device listening study was performed. Phone-speaker, wired-headphone and Bluetooth pleasantness and physical synchronization remain unmeasured. Technical signal bounds and successful browser checks do not establish user preference. Local source checks do not constitute production verification.
