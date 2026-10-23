import {createECDH,randomUUID} from 'node:crypto';
import {playTestConfig,playTestSetup,block} from './nile-play-fixture';
import {nilePublicKeyAddress} from '../../../server/finance/nile-address';
export async function pvpFixture(owners?:[string,string]){
 const key=createECDH('secp256k1');key.setPrivateKey(Buffer.from('17'.padStart(64,'0'),'hex'));
 const publicKey=key.getPublicKey('hex','uncompressed'),second={userId:'second',address:nilePublicKeyAddress(publicKey),publicKey};
 const config={...playTestConfig,initialReserveUnits:'0',source:{...playTestConfig.source,addresses:[...playTestConfig.source.addresses,second]}};
 const c=await playTestSetup(':memory:',()=>0,config,'200000000');
 await c.source.ingest(block(101,'200000000',second.address));await c.ledger.sync(c.source,await c.reconciliation());
 const [a,b]=owners??[randomUUID(),randomUUID()];await c.ledger.claim(a,await c.ledger.invite('player'));await c.ledger.claim(b,await c.ledger.invite('second'));
 return{...c,a,b,config};
}
