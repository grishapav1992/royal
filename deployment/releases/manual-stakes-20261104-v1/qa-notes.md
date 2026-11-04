# Manual stake verification

Application source: `64275feff275c9049a82e7b095dd89c4b71677da`.
Production baseline: `320d60725984c5cbd46829e9dc545f59cf9cd162`.

The final browser run used the prepared application and all 19 projected casino
packages. It did not inject preview CSS or override the source identity.
From the prepared checkout, the original command was:

```sh
env -u PREVIEW_SOURCE_COMMIT -u PREVIEW_ROULETTE_CSS -u CASE_ONLY -u CASE_GROUP node --import tsx ../host-fixture.test.mjs ..
```

The accompanying `host-fixture.test.mjs` and `force-entropy.cjs` are the exact
tested files. They accept a task-owned output directory. They require the normal
project dependencies, Chrome, disposable PostgreSQL support and the verified
baseline program inventory as `production-final-before.json` in that directory.
The inventory stays outside Git. Loopback ports 2904 and 5904 must be available.
The script creates only temporary local accounts and a disposable database.

Missing baseline public media is fetched read-only from the published site and
accepted only after its SHA-256 matches that inventory. Authentication, chat and
all gameplay use the local compiled backend. No production account, message or
wager is created. A controlled entropy preload supplies a reproducible Star Spin
free-spin sequence only to the disposable backend process. It is absent from the
published application and game packages.

The final run checked every casino game on desktop 1440x1000 and mobile 390x844
with the host chat connected. It confirmed custom amounts, rejected invalid
drafts, accepted 19 wagers and reopened every game without another debit. Star
Spin additionally covered typing `2,35`, a committed response lost in transit,
same-operation replay, eight free continuations and a separate touch-context
minimum-cost start. The total was 20 accepted wagers in the disposable database.
A mobile browser context does not establish verification on a physical phone.

The public byte checker only reads public resources, health and unauthenticated
API restrictions. It never places a production wager. Its result binds all
published module files, pointers and client deltas to the prepared payload.

The mathematical manual-range proof replays every integer cent from 10 through
5000 and each applicable mode or choice against the qualified full-round model.
It checks exact scaling and unbiased integer settlement. It is not an
independent Monte Carlo estimate at each denomination. Historical accepted
rounds are separately compared with the unchanged prior compiled adapters.

