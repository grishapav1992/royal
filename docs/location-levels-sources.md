# Sources of location experience

The MVP instruments the live shared `DemoWalletStore` and `VirtualPvpLedger` in `server/progression/sources.ts`. Both adapters preserve the existing engines and settlement rules. The host wires them once in `server/accounts.ts`. The environment is `VIRTUAL_USD`, and the trusted location is `south-park`. A Colyseus room instance ID is not a location ID.

## Settlement matrix

| Paid path | Stable source ID | Acceptance | Completion and amount evidence |
| --- | --- | --- | --- |
| Instant Coins, Fruits, roulette, originals through `wallet.operate` | `native:instant:<operation UUID>` | New confirmed `demo_operations` row; retries are excluded before execution | Stored `gameRound` identifies the game. Exact `bet` and `refund` entries of the same operation determine qualified turnover. A zero net balance change still counts the paid stake. |
| Hi-Lo through `wallet.casino.operate` | `native:casino:<session UUID>` | New start stored in `demo_casino_sessions` | All linked `demo_casino_requests` and the session ID bind the complete ledger history. Completion is any terminal state, including loss and cashout. |
| Expansion slots and other persistent casino games through `wallet.expansion.operate` | `native:casino:<session UUID>` | New start stored in `demo_casino_sessions` | Same session/request mapping. All paid start costs and subsequent paid actions are counted. Free continuations do not create another accepted source. |
| Mines through `wallet.mines.operate` | `native:mines:<session UUID>` | New stored Mines start | Terminal `demo_mines_sessions` state plus exact start/refund ledger entries. Reveals alone do not grant experience. |
| Orbit/Flight through `wallet.flight.operate` | `native:flight:<session UUID>` | New stored Flight start | Terminal `demo_flight_sessions` state. Manual cashout, timed automatic cashout and timed loss share one source. |
| Last EXIT/Crash automatic completion | Existing `native:casino:<session UUID>` | Original paid start only | The same pending-source scan runs after GETs, snapshots and unrelated commands. It detects completion caused by `settleDue` and does not depend on a POST response. |
| Ordinary PvP | `<match UUID>` with source type `pvp`, separately for each account | Confirmed new `virtual_pvp_holds` row | Final bank state and each participant's own held stake. Both winner and loser earn experience. A refunded bank contributes zero experience. |
| Mortal Kombat combat escrow | Same PvP match/account identity | Common `pvpHold` adapter used by combat escrow | Common `pvpFinish` adapter, including expiry and recovery refunds. No parallel combat experience implementation. |
| Awarded free spins | No paid-source context | Not accepted by the paid-source adapters | Reward uses are recorded by their own handler and do not grant experience. Their payouts are not interpreted as new paid turnover. |

## Atomicity and recovery

The wallet adapter opens the existing account transaction before invoking the original engine. The engine's nested transactions keep the same account lock. A new paid round is accepted only after its authoritative stored row exists, and only when the original operation UUID was not already accepted. The progression context and completion outbox record commit with the original money and session changes.

After each instrumented command, the adapter reads the account's pending accepted contexts. It resolves their canonical session state and records a completed fact only after the complete round ends. Reopening a game, repeating a request, restarting the process or reading a balance cannot recreate its source. No historical scan imports old sessions. A session started before instrumentation or before progression activation remains ineligible when it finishes.

The PvP adapter keeps the original outer transaction and ordered participant locks. It reads confirmed bank and hold metadata after the original method succeeds. It does not trust client-supplied payouts or game outcomes. Replayed holds and final settlements return without creating new contexts.

The adapters never infer paid turnover from `balanceAfter - balanceBefore`. Native amounts are summed from exact ledger `bet` and explicit `refund` entries belonging to the round. Cents are converted to integer micro-units by multiplying by 10,000. Ordinary winnings are not refunds. All source, environment and account identities are retained with the fact.

`progression_demo_ledger_operation` indexes the `(account_id, operation_id)` lookup used to aggregate a specific round. Source capture scans only already accepted pending contexts for the account, not the entire history of completed rounds.

## Extension boundary

`ProgressionSourceSink` exposes acceptance, completion and pending-context reads. A future source supplies a stable ID, account, trusted location, environment, funding type and acceptance time. It then supplies confirmed paid/refunded amounts and completion time. The progression store owns policy selection, experience and reward creation.

`NativeProgressionSources` accepts an explicit environment parameter for a future Nile adapter. The inactive Nile runtime and legacy direct Nile `spin` route are not automatically connected by this release. Activating them requires a separate adapter covering direct ledger spins and PvP in the same transaction, separate environment configuration and compatibility checks. Test-network activity must never earn rewards in the virtual or a future production money environment.

External provider callbacks are not a native game path. A provider enabled in the future needs its own authoritative completed-round adapter and explicit refund/reversal semantics before it can participate in levels.

## Verification

`server-tests/progression-sources.test.ts` covers zero net balance paid rounds, duplicate requests, terminal Mines states, Flight and Crash completion during a GET, old-session exclusion, a complete Afterglow bonus continuation, rollback after a capture failure, both PvP participants, combat identity and refunded draws. These checks use an isolated PostgreSQL database and the actual shared wallet implementations.
