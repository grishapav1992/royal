import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ExpansionClient} from '../src/wallet/ExpansionClient';
import {demoWallet} from '../src/wallet/WalletClient';
import {rebuildTempleView,templeResult,TEMPLE_GAME,TEMPLE_CLIENT_HEADER} from '../src/shared/floodedTemple';
import type {TempleAction} from '../src/shared/floodedTempleMath';
import type {ExpansionSession} from '../src/shared/casinoExpansion';
import {startTempleCascade,moveTempleCascade} from '../server/games/floodedTempleCascade';
import {CASCADE_DATA} from '../src/shared/floodedTempleCascadeMath';

const id=randomUUID();
function session(history:TempleAction[]=[]):ExpansionSession{
  const v=rebuildTempleView({layout:0,pattern:0,tier:0,relic:true},{layout:0,tier:0},'1000',history),result=templeResult(v);
  return {id,gameId:TEMPLE_GAME,rulesVersion:1,state:result.ended?'settled':'active',stakeUnits:'1000',spentUnits:'1000',returnedUnits:result.ended?v.totalPayoutUnits:'0',view:{player:[],dealer:[],community:[],temple:v,actions:result.actions,phase:v.revision+1,ended:result.ended,message:result.message}};
}
async function fixture(run:(client:ExpansionClient)=>Promise<void>,templeRules:1|2=1){
  const fetchBefore=globalThis.fetch,storageBefore=globalThis.sessionStorage,map=new Map<string,string>();
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>map.set(key,value),removeItem:(key:string)=>map.delete(key)}});
  const client=new ExpansionClient(templeRules);client.accountId='temple-client';
  try{await run(client);}finally{globalThis.fetch=fetchBefore;Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storageBefore});demoWallet.setExternalBusy('expansion',false);}
}
const reply=(s:ExpansionSession)=>({wallet:{balance:9990,entries:[]},sessions:[s],session:s,replayed:false});
test('client negotiates Temple on reads and writes and retries the saved UUID',()=>fixture(async client=>{
  let calls=0;const requests:string[]=[];
  globalThis.fetch=(async(_url,init)=>{
    assert.equal(new Headers(init?.headers).get(TEMPLE_CLIENT_HEADER),'1');
    if(init?.method!=='POST')return Response.json({wallet:{balance:10000,entries:[]},sessions:[]});
    const op=JSON.parse(String(init.body));requests.push(op.id);calls++;
    if(calls===1)throw Error('Lost response');
    return Response.json({...reply({...session(),id:op.id}),replayed:true});
  }) as typeof fetch;
  await client.refresh();assert.equal(client.error,'');
  await assert.rejects(client.act({action:'start',gameId:TEMPLE_GAME,stakeUnits:'1000',settings:{temple:{mode:'normal'}}}));
  assert(client.pending);await client.retry();assert.equal(requests[0],requests[1]);assert.equal(client.pending,undefined);assert.equal(client.sessions[0].state,'active');
}));

function cascadeSession(result:ReturnType<typeof startTempleCascade>,sessionId=id):ExpansionSession{
  return {id:sessionId,gameId:TEMPLE_GAME,rulesVersion:2,state:result.ended?'settled':'active',stakeUnits:'1000',spentUnits:'1000',returnedUnits:result.ended?result.view.totalPayoutUnits:'0',view:{player:[],dealer:[],community:[],templeCascade:result.view,actions:result.actions,phase:result.view.revision+1,ended:result.ended,message:result.message}};
}
test('v2 client negotiates rules two and retries the same accepted cascade start UUID',()=>fixture(async client=>{
  const seen:string[]=[];globalThis.fetch=(async(_url,init)=>{
    assert.equal(new Headers(init?.headers).get(TEMPLE_CLIENT_HEADER),'2');
    if(init?.method!=='POST')return Response.json({wallet:{balance:10000,entries:[]},sessions:[]});
    const op=JSON.parse(String(init.body));seen.push(op.id);if(seen.length===1)throw Error('Lost cascade response');
    const s=cascadeSession(startTempleCascade(op.settings,op.stakeUnits,()=>0),op.id);return Response.json({...reply(s),wallet:{balance:14990,entries:[]},replayed:true});
  })as typeof fetch;
  await client.refresh();await assert.rejects(client.act({action:'start',gameId:TEMPLE_GAME,stakeUnits:'1000',settings:{temple:{mode:'cascades'}}}));
  assert(client.pending);await client.retry();assert.equal(seen[0],seen[1]);assert.equal(client.pending,undefined);assert.equal(client.sessions[0].rulesVersion,2);
},2));
test('client rejects changed cascade sums, history and envelopes; a rules one client rejects rules two',()=>fixture(async client=>{
  const s=cascadeSession(startTempleCascade({temple:{mode:'cascades'}},'1000',()=>0));
  for(const mutate of[(r:any)=>r.session.view.templeCascade.state.totalPoints--,(r:any)=>r.session.view.templeCascade.totalPayoutUnits='1',(r:any)=>r.session.view.templeCascade.operations[0][0].push(0),(r:any)=>r.session.view.temple={}]){
    const r=reply(structuredClone(s));mutate(r);globalThis.fetch=(async()=>Response.json(r))as typeof fetch;await client.refresh();assert(client.error);assert.equal(client.sessions.length,0);
  }
  globalThis.fetch=(async()=>Response.json(reply(s)))as typeof fetch;
  const old=new ExpansionClient();old.accountId='temple-client';await old.refresh();assert(old.error);assert.equal(old.sessions.length,0);
},2));
test('a valid-looking cascade continuation cannot replace the already confirmed operation prefix',()=>fixture(async client=>{
  function seeded(seed:number){const tape:number[]=[];for(let c=0;c<5;c++)for(let r=2;r>=0;r--){const symbol=c<3?8:(c*3+r)%7;tape.push(CASCADE_DATA.baseReels[c].slice(0,symbol).reduce((a,b)=>a+b,0));}let v=seed;return(max:number)=>tape.length?tape.shift()!:(v=(Math.imul(v,1664525)+1013904223)>>>0)%max;}
  const first=startTempleCascade({temple:{mode:'cascades'}},'1000',seeded(8231));assert(!first.ended);client.sessions=[cascadeSession(first)];
  const other=seeded(9239),replacement=startTempleCascade({temple:{mode:'cascades'}},'1000',other);assert(!replacement.ended);
  const moved=moveTempleCascade(replacement.view,'1000',1,'temple-cascade',other);
  globalThis.fetch=(async()=>Response.json(reply(cascadeSession(moved))))as typeof fetch;
  await assert.rejects(client.act({action:'move',gameId:TEMPLE_GAME,sessionId:id,move:'temple-cascade',revision:1}));assert(client.pending);assert.deepEqual(client.sessions[0],cascadeSession(first));
},2));
test('client rejects mutated maps, overclaims and altered envelopes',()=>fixture(async client=>{
  for(const mutate of [
    (r:any)=>r.session.view.temple.baseMap.edges.pop(),
    (r:any)=>r.session.view.temple.totalPayoutUnits='100000',
    (r:any)=>r.session.view.actions[0].cost=1,
    (r:any)=>r.session.id='not-a-uuid',
    (r:any)=>r.session.view.neopolis={},
  ]){
    const value=reply(session());mutate(value);
    globalThis.fetch=(async()=>Response.json(value)) as typeof fetch;
    await client.refresh();assert(client.error);assert.equal(client.sessions.length,0);
  }
}));
test('paid reply requires the same confirmed session in the current sessions list',()=>fixture(async client=>{
  globalThis.fetch=(async(_url,init)=>{const op=JSON.parse(String(init?.body));return Response.json({...reply({...session(),id:op.id}),sessions:[]});}) as typeof fetch;
  await assert.rejects(client.act({action:'start',gameId:TEMPLE_GAME,stakeUnits:'1000',settings:{temple:{mode:'normal'}}}));assert(client.pending);assert.equal(client.sessions.length,0);
}));
test('move response must contain the requested history action and matching current session',()=>fixture(async client=>{
  const moved=session([{kind:'step',to:6}]);
  globalThis.fetch=(async()=>Response.json(reply(moved))) as typeof fetch;
  await client.act({action:'move',gameId:TEMPLE_GAME,sessionId:id,revision:1,move:'temple-step',picks:[6]});assert.equal(client.sessions[0].view.temple?.revision,2);
  await assert.rejects(client.act({action:'move',gameId:TEMPLE_GAME,sessionId:id,revision:1,move:'temple-rope',picks:[6]}));assert(client.pending);
}));
test('account change ignores an old response and never installs another account round',()=>fixture(async client=>{
  let release!:(value:Response)=>void;
  globalThis.fetch=(async()=>new Promise<Response>(resolve=>{release=resolve;})) as typeof fetch;
  const writing=client.act({action:'move',gameId:TEMPLE_GAME,sessionId:id,revision:1,move:'temple-step',picks:[6]});
  client.setAccount(null);release(Response.json(reply(session([{kind:'step',to:6}]))));await writing;
  assert.equal(client.accountId,null);assert.equal(client.sessions.length,0);assert.equal(client.wallet,undefined);assert.equal(client.pending,undefined);
}));
