import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const FOREST_WALLET_CASES=[
  'client-negotiation','concurrent-start-and-replay','saved-choice-and-private-future',
  'ownership-revisions-and-actions','free-turn-and-concurrent-revision','rollback-and-retry',
  'all-stakes-and-maximum-settlement','shared-pvp-balance','reserved-capacity',
  'invalid-entropy-rollback','cross-operation-identity',
];
export const forestWalletDigest=evidence=>createHash('sha256').update(JSON.stringify({cases:evidence.cases,ledger:evidence.ledger})).digest('hex');
export function validateForestWalletEvidence(value){
  assert(value&&value.method==='postgres-common-wallet-v1');
  assert.deepEqual(value.cases,FOREST_WALLET_CASES,'Incomplete Forest Heart wallet scenarios');
  assert.equal(value.sha256,forestWalletDigest(value),'Altered Forest Heart wallet evidence');
  assert(Array.isArray(value.ledger)&&value.ledger.length===2);
  for(const [i,row]of value.ledger.entries()){
    assert.equal(row.account,'synthetic-'+i);assert(Number.isSafeInteger(row.rows)&&row.rows>=1);
    for(const key of ['credits','debits','balance','reserved'])assert(/^(0|[1-9][0-9]*)$/.test(row[key]));
    assert.equal(BigInt(row.credits)-BigInt(row.debits),BigInt(row.balance));assert.equal(row.reserved,'0');
  }
  // Reconstruct the deterministic synthetic transcript, rather than accepting any balanced totals.
  const stakeSum=88000n,firstSeries=14n*631n,maximumCredits=stakeSum*1893n/2n;
  const credits=1000000n+firstSeries+maximumCredits,debits=1000n+stakeSum;
  assert.deepEqual(value.ledger,[
    {account:'synthetic-0',rows:15,credits:String(credits),debits:String(debits),balance:String(credits-debits),reserved:'0'},
    {account:'synthetic-1',rows:3,credits:'39000',debits:'19000',balance:'20000',reserved:'0'},
  ],'Common-wallet qualification transcript does not match its independently calculated settlements');
  return true;
}
