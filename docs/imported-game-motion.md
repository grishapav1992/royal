# GitHub game presentation

Scope: the nine current first-floor GitHub games, verified against `ARCADE_GITHUB_GAMES`. RoyalGames and the provider catalogue do not use this layer. Existing gameplay, outcomes, balances, recovery and host API 1 are unchanged.

Every selected package mounts its existing view through `mountImportedMotion`. The wrapper owns a shared sequence: button response, movement, confirmed landing, final result and a short celebration. A result hook runs beside each view's existing confirmed reaction. Saved results, refreshes and retries never manufacture another celebration. The wrapper contains no wallet, random outcome, transport or server rule. Host programs and all other game packages can remain byte-identical during independent publication.

## Timing and result policy

Use a 190 ms button response, 220 ms landing accent, 340 ms cell reveal, 950 ms ordinary celebration, 1500 ms large win and 2100 ms exceptional win. Large effects can be skipped and a new action clears the previous effect immediately. Royal Fruits now uses elapsed frame time rather than a fixed increment, keeping the visual speed consistent across 60 Hz and 120 Hz displays. Its shorter acceleration and staggered braking preserve the confirmed reel symbols.

Compare complete round return against the full round stake using integer units. A return below stake gets no winning particles, celebratory counter or fanfare. Exact stake returns remain neutral. Positive profit gets a short themed accent; returns of at least 5 times stake and 20 times stake use larger effects. The overlay labels the actual return and net profit separately. The animated headline counts profit. No expected payout, near miss or unconfirmed result is invented.

## Theme variations

Cherry Express uses warm flower sparks; Alchemist uses soft green chimes; Andromeda uses violet stars; Eldorado uses golden fragments; Star Atlas uses blue constellations; Midnight Jazz uses musical notes; Dragon Citadel uses amber embers; Aurora Vault uses crystal chimes; Scarab Tomb uses gold and turquoise accents. The timing, accounting and lifecycle are common. Color, particle shape and musical scale live in `Profiles.ts`.

Procedural voices connect to the host's existing audio context, master volume and limiter. They stop on mute, volume zero, hidden tabs, account changes, close and disposal. Games that already have native spin audio keep it; the shared layer adds a short final accent after the native presentation. No additional music or audio network downloads are needed.

## Accessibility and performance

Use transforms and opacity for motion. Reduced motion receives the exact static result with no particles or counting animation. Cancel all animation frames, Web Animations and audio voices on close, hidden tabs, preference changes and account changes. The result overlay stays inside the visible game pane and does not cover the shared chat or block another spin. Generic network timeouts do not retry gameplay or adjust balances.

Research informing these implementation choices:

- [Google web.dev: high-performance animations](https://web.dev/articles/animations-guide), limiting animated work to transforms and opacity.
- [MDN: Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), shared audio scheduling and user volume control.
- [W3C: animation from interactions](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions), support for reduced motion.
- [Material Design motion](https://m3.material.io/styles/motion), responsive movement and coherent motion systems.

Exact durations and theme variations above are project design decisions, not values prescribed by those sources. The common lifecycle and precise-money tests accompany real host tests with PostgreSQL, WebSocket and chat on desktop and mobile. Rare-tier visual previews in local tests block the game's request handler and inject only a presentation receipt, without changing a wallet or sending a bet. Production testing must not manufacture stakes or accounts.
