import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const outputFolder=new URL('../../../artifacts/work/caramel-audit-20261026/',import.meta.url);
mkdirSync(outputFolder,{recursive:true});
try{writeFileSync(new URL('OWNER.txt',outputFolder),"Owner: Caramel audit runner\nPurpose: generated current-rules Caramel audit output\nCleanup: preserve compact results in GitHub when needed, then remove obsolete task-owned diagnostics; source and tracked evidence are never written here\n",{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}


const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const engine=await import(pathToFileURL(resolve(root,'server/games/caramelCarnival.ts')));
const shared=await import(pathToFileURL(resolve(root,'src/shared/caramelCarnival.ts')));
const {startCaramel,moveCaramel,CaramelMoveError,CARAMEL_MATH}=engine;
const {CARAMEL_BETS,CARAMEL_PAYTABLE,validCaramelSettlement,caramelPayout}=shared;
const tests=[];
function test(name,run){run();tests.push(name);}
const clone=value=>JSON.parse(JSON.stringify(value));
const balanced=n=>Array.from({length:n},(_,i)=>i%7);
const tickets=n=>[...Array(n).fill(7),...balanced(30-n)];
const fromColumnOrder=values=>Array.from({length:30},(_,i)=>values[(i%6)*5+Math.floor(i/6)]);
const energyGrid=[...Array(12).fill(6),...Array(18).fill(11)];

function entropy(){
 const queue=[];let cursor=0;
 function draw(max){assert(cursor<queue.length,`Unexpected RNG draw ${max}`);const expected=queue[cursor++];assert.equal(max,expected[0]);return expected[1];}
 function symbols(values,free){for(const symbol of values){if(symbol===7)queue.push([1000000,0]);else if(symbol<7)queue.push([1000000,999999],[7,symbol]);else queue.push([1000000,free?CARAMEL_MATH.freeTicketPerMillion:CARAMEL_MATH.baseTicketPerMillion],[100,[0,52,77,95][symbol-8]]);}}
 function spin(initial,refills,free){assert.equal(initial.length,30);symbols(initial,free);for(const refill of refills)symbols(refill,free);}
 return {draw,spin,done(){assert.equal(cursor,queue.length,'Unused entropy');},get calls(){return cursor;}};
}
function valid(result,stake='100'){
 const spent=String(BigInt(stake)*BigInt(result.view.mode==='festival'?35:1));
 assert(validCaramelSettlement(result.ended?'settled':'active',stake,spent,result.ended?String(result.credit):'0',result.view));
 assert.equal(result.credit,result.ended?Number(result.view.totalPayoutUnits):0);
 assert(validCaramelSettlement(result.ended?'settled':'active',stake,spent,result.ended?String(result.credit):'0',clone(result.view)));
 return result;
}
function purchase(stake='100'){
 let calls=0;const result=valid(startCaramel({caramel:{mode:'festival'}},stake,()=>{calls++;throw Error('Purchase must not draw');}),stake);
 assert.equal(calls,0);assert.deepEqual(result.view.bonus,{awarded:10,played:0,remaining:10,multiplier:1});
 assert.equal(result.view.spin,null);assert.deepEqual(result.view.history,[]);assert(!result.ended);assert.equal(result.credit,0);
 return result;
}
function next(previous,initial=balanced(30),refills=[],stake='100'){
 const e=entropy();e.spin(initial,refills,true);const result=valid(moveCaramel(clone(previous.view),stake,previous.view.revision,e.draw),stake);e.done();return result;
}
function base(initial,refills=[],stake='100'){
 const e=entropy();e.spin(initial,refills,false);const result=valid(startCaramel({caramel:{mode:'normal'}},stake,e.draw),stake);e.done();return result;
}
function finish(previous,stake='100',winning=false){let result=previous;while(!result.ended)result=next(result,winning?Array(30).fill(0):balanced(30),winning?[balanced(30)]:[],stake);return result;}
function invalidMove(view,revision=view.revision){let calls=0;assert.throws(()=>moveCaramel(view,'100',revision,()=>{calls++;return 0;}),CaramelMoveError);assert.equal(calls,0);}
function validateView(view,state='active',stake='100'){
 return validCaramelSettlement(state,stake,String(BigInt(stake)*BigInt(view.mode==='festival'?35:1)),state==='settled'?view.totalPayoutUnits:'0',view);
}

test('Purchased origin is empty, x1, ten spins, no RNG or credit',()=>purchase());
test('Forged empty purchased origins are rejected before RNG',()=>{
 const legal=purchase().view;
 for(const mutate of [v=>v.bonus.multiplier=50,v=>v.bonus.awarded=30,v=>v.bonus.remaining=30,v=>v.totalPayoutUnits='100',v=>v.capped=true]){
  const forged=clone(legal);mutate(forged);assert(!validateView(forged));invalidMove(forged);
 }
});
test('Three base tickets do not trigger and four or more award ten',()=>{
 assert(base(tickets(3)).ended);
 for(const count of [4,5,30]){const result=base(tickets(count));assert(!result.ended);assert.equal(result.view.spin.tickets,count);assert.equal(result.view.spin.freeAward,10);assert.equal(result.view.bonus.remaining,10);assert.equal(result.view.bonus.multiplier,1);}
});
test('Natural entry resets base x50 to bonus x1 and retains base payment',()=>{
 const result=base([...Array(12).fill(6),...Array(4).fill(7),...Array(14).fill(11)],[balanced(26)]);
 assert.equal(result.view.spin.multiplierAfter,50);assert.equal(result.view.spin.payoutUnits,'18750');
 assert.equal(result.view.spin.tickets,4);assert.equal(result.view.bonus.multiplier,1);assert.equal(result.view.totalPayoutUnits,'18750');
 const continued=next(result);assert.equal(continued.view.spin.multiplierBefore,1);assert.equal(continued.view.totalPayoutUnits,'18750');
});
test('Free energy rises before payout, persists across free spins and resets on a new paid round',()=>{
 const raised=next(purchase(),energyGrid,[balanced(30)]);assert.equal(raised.view.spin.frames[0].energy,180);
 assert.equal(raised.view.spin.frames[0].multiplierAfter,50);assert.equal(raised.view.totalPayoutUnits,'18750');assert.equal(raised.view.bonus.multiplier,50);
 const preserved=next(raised);assert.equal(preserved.view.spin.multiplierBefore,50);assert.equal(preserved.view.bonus.multiplier,50);assert.equal(preserved.credit,0);
 const complete=finish(preserved);assert.equal(complete.credit,18750);assert(complete.ended);
 assert.equal(purchase().view.bonus.multiplier,1);assert.equal(base(balanced(30)).view.spin.multiplierBefore,1);
});
test('Energy without a winning ordinary group does not charge or pay',()=>{
 const result=next(purchase(),Array(30).fill(11));assert.equal(result.view.spin.frames.length,1);assert.equal(result.view.spin.frames[0].energy,0);
 assert.equal(result.view.bonus.multiplier,1);assert.equal(result.view.totalPayoutUnits,'0');assert.deepEqual(result.view.spin.frames[0].removed,[]);
});
test('Every energy value is applied and spinner cells disappear with wins',()=>{
 for(const [symbol,energy] of [[8,2],[9,3],[10,5],[11,10]]){
  const initial=[...Array(12).fill(6),symbol,...balanced(17)],count=initial.filter(s=>s===6).length;
  const refill=balanced(count+1),result=next(purchase(),initial,[refill]);const frame=result.view.spin.frames[0];
  assert.equal(frame.energy,energy);assert.equal(frame.multiplierAfter,1+energy);assert(frame.removed.includes(12));
  assert.equal(frame.payoutUnits,String(BigInt(CARAMEL_PAYTABLE[6][2]*(1+energy))));
 }
});
test('Free retriggers are 3, capped at thirty awarded spins including final partial grant',()=>{
 let result=purchase();const awards=[];
 while(!result.ended){result=next(result,tickets(3));awards.push(result.view.spin.freeAward);assert(result.view.bonus.awarded<=30);}
 assert.equal(result.view.history.length,30);assert.equal(result.view.bonus.awarded,30);assert.equal(result.view.bonus.played,30);assert.equal(result.view.bonus.remaining,0);
 assert.deepEqual(awards.slice(0,7),[3,3,3,3,3,3,2]);assert(awards.slice(7).every(n=>n===0));assert.equal(result.credit,0);
 invalidMove(result.view);
});
test('Normal entry plus maximum free retriggers produces exactly thirty one history entries',()=>{
 let result=base(tickets(4));while(!result.ended)result=next(result,tickets(3));
 assert.equal(result.view.history.length,31);assert.equal(result.view.bonus.awarded,30);assert.equal(result.view.history.filter(s=>s.kind==='base').length,1);
 assert.equal(result.credit,0);
});
test('Cascade limit pays twenty frames and counts tickets on the final unscored refill',()=>{
 const refills=[...Array.from({length:19},()=>Array(30).fill(0)),tickets(4)];
 const result=base(Array(30).fill(0),refills);assert.equal(result.view.spin.frames.length,20);
 assert.equal(result.view.spin.frames.at(-1).stop,'cascade-limit');assert.equal(result.view.spin.payoutUnits,'1500');
 assert.deepEqual(result.view.spin.finalGrid,fromColumnOrder(tickets(4)));assert.equal(result.view.spin.tickets,4);assert.equal(result.view.spin.freeAward,10);
});
test('Whole round cap stops cascade and free spins, pays remaining amount, suppresses ticket retrigger',()=>{
 let result=next(purchase(),energyGrid,Array.from({length:20},()=>Array(30).fill(6)));
 assert.equal(result.view.totalPayoutUnits,'375000');assert.equal(result.view.bonus.multiplier,50);
 result=next(result,[...Array(12).fill(6),...Array(18).fill(7)],Array.from({length:6},()=>Array(12).fill(6)));
 assert(result.ended);assert(result.view.capped);assert.equal(result.credit,500000);assert.equal(result.view.totalPayoutUnits,'500000');
 const spin=result.view.spin,frame=spin.frames.at(-1);assert.equal(spin.frames.length,7);assert.equal(spin.payoutUnits,'125000');
 assert.equal(frame.stop,'win-cap');assert.equal(frame.payoutUnits,'12500');assert.equal(frame.uncappedPayoutUnits,'18750');
 assert.equal(spin.tickets,18);assert.equal(spin.freeAward,0);assert.equal(result.view.bonus.remaining,0);assert.deepEqual(frame.refills,[]);invalidMove(result.view);
});
test('Cap allocates a limited frame across simultaneous groups with no negative awards',()=>{
 const grid=[...Array(10).fill(0),...Array(10).fill(1),...Array(10).fill(6)],payment=caramelPayout(grid,50,'100',11n);
 assert.equal(payment.paid,11n);assert.deepEqual(payment.wins.map(w=>w.payoutUnits),['11','0','0']);assert.equal(payment.raw,11650n);
});
test('Gravity preserves ticket order and uses only emptied cells for refills',()=>{
 const initial=[...Array(12).fill(6),...Array(4).fill(7),...Array(14).fill(11)],result=base(initial,[balanced(26)]),frame=result.view.spin.frames[0];
 assert.equal(frame.removed.length,26);assert.equal(frame.drops.length,4);assert.equal(frame.refills.length,26);
 assert(frame.drops.every(drop=>drop.symbol===7&&drop.from%6===drop.to%6));
 assert.deepEqual(frame.drops.map(drop=>drop.to),[24,25,26,27]);assert.equal(frame.after.filter(s=>s===7).length,4);
});
test('All thirteen stakes scale normal and complete purchased settlement exactly',()=>{
 for(const stake of CARAMEL_BETS){
  const ordinary=base(Array(30).fill(0),[balanced(30)],stake);assert.equal(BigInt(ordinary.credit),BigInt(stake)*75n/100n);
  const purchased=finish(next(purchase(stake),Array(30).fill(0),[balanced(30)],stake),stake);
  assert.equal(BigInt(purchased.credit),BigInt(stake)*75n/100n);assert.equal(purchased.view.history.length,10);
 }
});

function forgeMultiplier(value,multiplier){
 const view=clone(value);let total=0n;
 for(const spin of view.history){let paid=0n;
  spin.multiplierBefore=spin.multiplierAfter=multiplier;
  for(const frame of spin.frames){frame.multiplierBefore=frame.multiplierAfter=multiplier;let payment=0n;
   for(const win of frame.wins){win.factor=multiplier;const amount=BigInt(win.payHundredths)*BigInt(multiplier);win.payoutUnits=win.uncappedPayoutUnits=String(amount);payment+=amount;}
   frame.payoutUnits=frame.uncappedPayoutUnits=String(payment);paid+=payment;
  }
  spin.payoutUnits=spin.uncappedPayoutUnits=String(paid);total+=paid;
 }
 view.totalPayoutUnits=String(total);view.bonus.multiplier=multiplier;view.spin=view.history.at(-1)??null;return view;
}
test('Self consistent active and complete x50 origin receipts are rejected',()=>{
 const first=next(purchase(),Array(30).fill(0),[balanced(30)]),complete=finish(first,'100',true);
 const active=forgeMultiplier(first.view,50),settled=forgeMultiplier(complete.view,50);
 assert(!validateView(active));invalidMove(active);assert(!validateView(settled,'settled'));invalidMove(settled);
});
test('Forged counts, frame payment, gravity, award, multiplier and revision are rejected',()=>{
 const source=next(purchase(),[...Array(12).fill(6),...Array(3).fill(7),...Array(15).fill(11)],[balanced(27)]).view;
 for(const mutate of [
  v=>v.bonus.awarded++,v=>v.bonus.remaining++,v=>v.bonus.played++,v=>v.bonus.multiplier--,
  v=>v.history[0].freeAward=6,v=>v.totalPayoutUnits=String(BigInt(v.totalPayoutUnits)+1n),
  v=>v.history[0].frames[0].wins[0].payoutUnits='999',v=>v.history[0].frames[0].energy++,
  v=>v.history[0].frames[0].drops[0].to=0,v=>v.history[0].frames[0].refills[0].position=29,
  v=>v.history[0].frames.pop(),v=>v.history[0].kind='base',v=>v.mode='normal',v=>v.revision++,
 ]){const forged=clone(source);mutate(forged);forged.spin=forged.history.at(-1);assert(!validateView(forged));invalidMove(forged);}
 invalidMove(source,source.revision-1);
});
test('Normal has no empty receipt and active or settled status must match continuation',()=>{
 const bought=purchase(),complete=finish(bought),normal=clone(bought.view);normal.mode='normal';normal.bonus=null;
 assert(!validateView(normal,'settled'));assert(!validateView(bought.view,'settled'));assert(!validateView(complete.view,'active'));
});
test('Invalid stakes and settings are refused before RNG',()=>{
 for(const stake of ['0','1','99','101','100001','-100','1e2','0100'])assert.throws(()=>startCaramel({caramel:{mode:'festival'}},stake,()=>{throw Error('RNG used');}),CaramelMoveError);
 for(const settings of [{caramel:{mode:'other'}},{caramel:{mode:'festival',extra:true}},{caramel:{mode:'normal'},extra:true}])assert.throws(()=>startCaramel(settings,'100',()=>{throw Error('RNG used');}),CaramelMoveError);
});

const files=['server/games/caramelCarnival.ts','src/shared/caramelCarnival.ts','src/ui/CaramelCarnivalUI.ts'];
const report={generatedAt:new Date().toISOString(),gameId:'studio-caramel-carnival',method:'Controlled entropy through actual server start/move, serialized full-history validation, no database or production writes.',modes:[{id:'normal',costMultiplier:1},{id:'festival',costMultiplier:35}],stakes:CARAMEL_BETS,passed:tests.length,tests,sourceHashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')]))};
const output=fileURLToPath(new URL('native-engine-results.json',outputFolder));writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:tests.length,output}));
