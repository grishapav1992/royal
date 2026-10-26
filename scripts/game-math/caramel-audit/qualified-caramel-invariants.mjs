// Read-only checks of current Caramel origin, settlement and continuation invariants.
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {startCaramel,moveCaramel} from '../../../server/games/caramelCarnival.ts';
import {CARAMEL_BETS,validCaramelSettlement} from '../../../src/shared/caramelCarnival.ts';
const outputFolder=new URL('../../../artifacts/work/caramel-audit-20261026/',import.meta.url);
mkdirSync(outputFolder,{recursive:true});
try{writeFileSync(new URL('OWNER.txt',outputFolder),"Owner: Caramel audit runner\nPurpose: generated current-rules Caramel audit output\nCleanup: preserve compact results in GitHub when needed, then remove obsolete task-owned diagnostics; source and tracked evidence are never written here\n",{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}

let assertions=0,forgeries=0;
const check=(value,message)=>{assert(value,message);assertions++;};
const ordinary=()=>{let next=0,pending=false;return max=>{if(!pending){assert.equal(max,1000000);pending=true;return 999999;}assert.equal(max,7);pending=false;return next++%7;};};
const forcedSymbols=values=>{let next=0,pending=null;return max=>{if(pending!==null){const symbol=pending;pending=null;assert.equal(max,symbol<7?7:100);return symbol<7?symbol:95;}assert.equal(max,1000000);pending=values[next++%values.length];return pending<7?999999:30000;};};
for(const stake of CARAMEL_BETS){
 let draws=0;
 const purchase=startCaramel({caramel:{mode:'festival'}},stake,()=>{draws++;return 0;});
 const spent=String(BigInt(stake)*35n),valid=view=>validCaramelSettlement('active',stake,spent,'0',view);
 check(draws===0,'Purchase only creates the saved feature; it does not draw or pay a spin');
 check(!purchase.ended&&purchase.credit===0&&purchase.view.history.length===0&&purchase.view.bonus.multiplier===1,'Initial purchase state');
 check(valid(purchase.view),'Current purchase validates');
 for(const mutate of [v=>v.bonus.multiplier=50,v=>v.bonus.awarded=30,v=>v.bonus.remaining=30,v=>v.bonus.played=1,v=>v.mode='normal',v=>v.totalPayoutUnits='1']){
  const forged=structuredClone(purchase.view);mutate(forged);check(!valid(forged),'Forged purchase origin rejected');forgeries++;
  assert.throws(()=>moveCaramel(forged,stake,forged.revision,ordinary()));assertions++;
 }
 check(!validCaramelSettlement('active',stake,stake,'0',purchase.view),'Purchase requires all 35 stakes in spent');
 check(!validCaramelSettlement('settled',stake,spent,'0',purchase.view),'Unplayed purchase is active');
 const next=moveCaramel(purchase.view,stake,0,ordinary());
 check(!next.ended&&next.credit===0&&next.view.bonus.played===1&&next.view.bonus.remaining===9,'Free continuation advances once without credit');
 check(valid(next.view),'Continued feature validates');
 assert.throws(()=>moveCaramel(next.view,stake,0,ordinary()));assertions++;
 const forged=structuredClone(next.view);forged.history[0].multiplierBefore=50;forged.history[0].multiplierAfter=50;
 for(const frame of forged.history[0].frames){frame.multiplierBefore=50;frame.multiplierAfter=50;}
 forged.bonus.multiplier=50;forged.spin=forged.history[0];
 check(!valid(forged),'Self-consistent no-win first spin cannot forge initial multiplier');forgeries++;
 let complete=next;
 while(!complete.ended)complete=moveCaramel(complete.view,stake,complete.view.revision,ordinary());
 check(complete.view.history.length===10&&complete.view.bonus.remaining===0&&complete.credit===0,'Ten no-win purchased free spins settle once');
 check(validCaramelSettlement('settled',stake,spent,'0',complete.view),'Complete feature validates');
 assert.throws(()=>moveCaramel(complete.view,stake,complete.view.revision,ordinary()));assertions++;
 const normal=startCaramel({caramel:{mode:'normal'}},stake,ordinary());
 check(normal.ended&&normal.credit===0&&normal.view.bonus===null&&normal.view.history.length===1,'Normal no-win round settles without carry');
 check(validCaramelSettlement('settled',stake,stake,'0',normal.view),'Normal round validates at its own cost');
 const normalCap=startCaramel({caramel:{mode:'normal'}},stake,forcedSymbols([...Array(12).fill(6),...Array(12).fill(5),...Array(6).fill(11)]));
 check(normalCap.ended&&normalCap.view.capped&&normalCap.credit===Number(stake)*5000,'Normal whole-round cap settles immediately');
 check(normalCap.view.history.length===1&&normalCap.view.spin.frames.length===16&&normalCap.view.bonus===null,'Base cap cancels further cascades and any feature entry');
 check(validCaramelSettlement('settled',stake,stake,String(normalCap.credit),normalCap.view),'Normal capped round validates');
 const spinnersOnly=moveCaramel(purchase.view,stake,0,forcedSymbols([11]));
 check(spinnersOnly.view.bonus.multiplier===1&&spinnersOnly.view.spin.frames[0].energy===0,'Spinners without an ordinary win do not increase multiplier');
 check(spinnersOnly.view.spin.frames[0].removed.length===0&&spinnersOnly.view.spin.frames.length===1,'No-win spinners do not cause a cascade');
}
const report={generatedAt:new Date().toISOString(),assertions,forgedStateCases:forgeries,stakes:CARAMEL_BETS.map(Number),sourceHashes:Object.fromEntries(['server/games/caramelCarnival.ts','src/shared/caramelCarnival.ts'].map(path=>[path,createHash('sha256').update(readFileSync(new URL('../../../'+path,import.meta.url))).digest('hex')])),
 findings:'Current Caramel reconstructs the purchase origin at multiplier 1 and rejects self-consistent forged first-spin multiplier states. Normal and festival paid costs, no-win continuations, stale revisions and finalization are checked here. Wallet transport and cross-device recovery are audited separately.'};
writeFileSync(new URL('qualified-caramel-invariants.json',outputFolder),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
