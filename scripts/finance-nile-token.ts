import { NileRpc, NILE_ORIGINS } from '../server/finance/tron-rpc';
import { NILE_TEST_TOKEN } from '../server/finance/nile-test-ledger';
import { record, rejectTron } from '../server/finance/tron-protocol';

try {
  if (process.env.NILE_TEST_MODE !== 'testnet-only' || process.env.NILE_TEST_NETWORK !== 'nile') throw new Error();
  const proofs = await Promise.all(NILE_ORIGINS.map(async (origin,index) => {
    const source = new NileRpc('nile-' + index,origin), genesis = await source.genesis();
    const response = await fetch(origin + '/walletsolidity/triggerconstantcontract', {
      method: 'POST', headers: { 'content-type':'application/json' }, redirect:'error', signal:AbortSignal.timeout(10000),
      body:JSON.stringify({owner_address:NILE_TEST_TOKEN,contract_address:NILE_TEST_TOKEN,function_selector:'decimals()',visible:false}),
    });
    if (!response.ok) rejectTron('test_token_rpc_failed');
    const result = record(await response.json());
    if (record(result.result).result !== true || !Array.isArray(result.constant_result) || result.constant_result.length !== 1
      || result.constant_result[0] !== '0'.repeat(63) + '6') rejectTron('test_token_scale_mismatch');
    return {origin,genesis,token:NILE_TEST_TOKEN,scale:6};
  }));
  console.log(JSON.stringify({ok:true,network:'nile',testOnly:true,checkedAt:new Date().toISOString(),proofs}));
} catch { console.error(JSON.stringify({ok:false,code:'test_token_verification_failed'})); process.exitCode=1; }
