import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyForestHeartWallet} from '../scripts/game-math/forest-heart-wallet';
// @ts-expect-error Pure JavaScript schema is shared with the fast build gate.
import {validateForestWalletEvidence} from '../scripts/game-math/forest-heart-evidence.mjs';
test('Postgres common wallet qualifies recovery, idempotency, rollback, every stake and shared PvP funds',{timeout:60000},async()=>{
  const evidence=await qualifyForestHeartWallet();assert(validateForestWalletEvidence(evidence));
  const changed=structuredClone(evidence);changed.cases.pop();assert.throws(()=>validateForestWalletEvidence(changed));
});
