import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {STUDIO_INFO,STUDIO_DEFAULTS,studioBaseFrame,studioBonusFrame,studioPayFrame,studioSlotHasBonus,studioClusterPresentationDetails,validStudioEnvelope,validStudioSettlement,validStudioSlotPresentation,type StudioClusterPresentationGameId,type StudioRawFrame,type StudioSlotView,type StudioSlotPresentationFrame} from '../src/shared/studioGames';
import {startStudioGame,moveStudioGame,currentStudioSlotPresentation,type StudioResult} from '../server/games/studioGames';

const directory='artifacts/studio-wave4-20261012',sessionId='77777777-7777-4777-8777-777777777777';
const games:StudioClusterPresentationGameId[]=['studio-lumen-grove','studio-prism-atelier'];
type Fixture={name:string;gameId:StudioClusterPresentationGameId;stops:number[];seeds:number[];results:StudioResult[]};
const golden=JSON.parse(readFileSync(new URL('./fixtures/studio-cluster-presentation-v1.json',import.meta.url),'utf8')) as Fixture[];
const phase=(result:StudioResult)=>result.ended?1:(result.studio as StudioSlotView).step+1;
const payload=(game:StudioClusterPresentationGameId,result:StudioResult)=>({version:1 as const,sessionId,phase:phase(result),...currentStudioSlotPresentation(game,result.engine)});
const rawWins=(frame:StudioRawFrame)=>frame.wins.map(({kind,symbol,positions,count,raw})=>({kind,symbol,positions:[...positions].sort((a,b)=>a-b),count,raw}));

function independentWins(game:StudioClusterPresentationGameId,grid:number[],step:number){
  const cols=6,visited=new Set<number>(),wins:{kind:'cluster'|'collect';symbol:number;positions:number[];count:number;raw:number}[]=[];
  for(let origin=0;origin<grid.length;origin++){
    if(visited.has(origin)||grid[origin]>3)continue;
    const symbol=grid[origin],pending=[origin],positions:number[]=[];visited.add(origin);
    while(pending.length){const at=pending.pop()!;positions.push(at);const neighbors=[at-cols,at+cols];if(at%cols)neighbors.push(at-1);if(at%cols<cols-1)neighbors.push(at+1);
      for(const next of neighbors)if(next>=0&&next<grid.length&&!visited.has(next)&&grid[next]===symbol){visited.add(next);pending.push(next);}}
    if(positions.length>=5){positions.sort((a,b)=>a-b);const factor=game==='studio-prism-atelier'?positions.reduce((sum,i)=>sum+1+(i+step)%3,0):positions.length;wins.push({kind:'cluster',symbol,positions,count:positions.length,raw:(positions.length-4)*(symbol+2)*2*factor});}
  }
  if(game==='studio-lumen-grove'){
    const coins=grid.flatMap((symbol,i)=>symbol===5?[i]:[]),collectors=grid.flatMap((symbol,i)=>symbol===4?[i]:[]).slice(0,2);
    if(coins.length)for(const collector of collectors)wins.push({kind:'collect',symbol:5,positions:[collector,...coins].sort((a,b)=>a-b),count:coins.length+1,raw:coins.reduce((sum,i)=>sum+2+i%4,0)});
  }
  return wins;
}
function checkTrace(details:StudioSlotPresentationFrame,frame:StudioRawFrame,step:number){
  const game=details.gameId as StudioClusterPresentationGameId,trace=details.cluster!;assert(trace);
  assert.deepEqual(details.beforeGrid,frame.grid);assert.deepEqual(details.afterGrid,frame.grid);
  assert.deepEqual([details.heldBefore,details.heldAfter,details.events,details.multipliers],[[],[],[],[]]);assert.equal(details.cascade,undefined);
  assert.deepEqual(rawWins(frame),independentWins(game,frame.grid,step));
  assert.deepEqual(trace.groups,frame.wins.flatMap((win,winIndex)=>win.kind==='cluster'?[{winIndex,symbol:win.symbol,count:win.count,positions:win.positions}]:[]));
  if(game==='studio-lumen-grove'){
    const coins=frame.grid.flatMap((symbol,position)=>symbol===5?[{position,rawValue:2+position%4}]:[]),collectors=frame.grid.flatMap((symbol,position)=>symbol===4?[position]:[]).slice(0,2);
    assert.deepEqual(trace.collects,coins.length?collectors.map(collector=>({winIndex:frame.wins.findIndex(win=>win.kind==='collect'&&win.positions[0]===collector),collector,coins})):[]);
    assert.deepEqual(trace.cellValues,[]);assert.deepEqual(trace.groupFactors,[]);
    trace.collects.forEach(collect=>{assert.equal(frame.grid[collect.collector],4);assert.equal(collect.coins.reduce((sum,coin)=>sum+coin.rawValue,0),frame.wins[collect.winIndex].raw);});
  }else{
    assert.deepEqual(trace.collects,[]);assert.deepEqual(trace.cellValues,frame.grid.map((_,position)=>({position,value:1+(position+step)%3})));
    assert.deepEqual(trace.groupFactors,trace.groups.map(group=>({winIndex:group.winIndex,factor:group.positions.reduce((sum,i)=>sum+1+(i+step)%3,0)})));
    for(const group of trace.groups){const factor=trace.groupFactors.find(item=>item.winIndex===group.winIndex)!.factor;assert.equal(frame.wins[group.winIndex].raw,(group.count-4)*(group.symbol+2)*2*factor);}
  }
  assert(!/"(engine|seeds|seed|stops|settings|balance|raw|payoutUnits|totalPayoutUnits)"/.test(JSON.stringify(details)));
}

test('Cluster metadata preserves golden strict results, payouts, no-bonus and both real free stages',()=>{
  let frames=0,free=0,zero=0;
  for(const fixture of golden){let calls=0,draws=[...fixture.stops,...fixture.seeds];let result=startStudioGame(fixture.gameId,STUDIO_DEFAULTS[fixture.gameId],'1000',()=>{calls++;return draws.shift()!;});
    for(let step=0;step<fixture.results.length;step++){
      assert.equal(JSON.stringify(result),JSON.stringify(fixture.results[step]));assert.equal(calls,8);
      const view=result.studio as StudioSlotView,metadata=payload(fixture.gameId,result),before=JSON.stringify(result);
      assert(validStudioSettlement(fixture.gameId,result.ended?'settled':'active','1000','1000',String(result.credit),view));
      assert(validStudioEnvelope(fixture.gameId,result.ended?'settled':'active',{studio:view,player:[],dealer:[],community:[],actions:result.ended?[]:[{move:'studio-spin',label:'Продолжить бесплатный бонус',cost:0}],phase:phase(result),ended:result.ended,message:result.message}));
      assert(validStudioSlotPresentation(metadata,fixture.gameId,sessionId,phase(result),view));checkTrace(metadata,view.history[step],step);
      assert.equal(JSON.stringify(result),before);assert.equal(view.held.length,0);assert.equal(view.stage,step?'free-spin':'base');
      assert.equal(Object.keys(view).sort().join(),'cols,grid,held,history,kind,maxSteps,remaining,rows,stage,step,totalPayoutUnits,wins');
      const future=structuredClone(result.engine) as {seeds:number[]};
      if(step===0){future.seeds=[5,4];assert.deepEqual(currentStudioSlotPresentation(fixture.gameId,future),currentStudioSlotPresentation(fixture.gameId,result.engine));}
      if(step===1){future.seeds[1]=(future.seeds[1]+1)%6;assert.deepEqual(currentStudioSlotPresentation(fixture.gameId,future),currentStudioSlotPresentation(fixture.gameId,result.engine));}
      if(step)free++;if(!view.wins.length)zero++;frames++;
      if(!result.ended)result=moveStudioGame(fixture.gameId,result.engine,'studio-spin',undefined,'1000');
    }
  }
  const maximum=golden.filter(f=>f.name==='maximum');assert.deepEqual(maximum.map(f=>f.results.at(-1)!.credit),[4347,4518]);
  assert(golden.some(f=>f.gameId==='studio-lumen-grove'&&f.name==='minimum'&&f.results[0].credit===78));
  assert(golden.some(f=>f.gameId==='studio-prism-atelier'&&f.name==='minimum'&&f.results.length===3&&f.results.at(-1)!.credit===0));
  const four=golden.find(f=>f.name==='fourClusters')!;assert.equal(payload(four.gameId,four.results[0]).cluster!.groups.length,4);
  mkdirSync(directory,{recursive:true});writeFileSync(directory+'/metadata-golden-proof.json',JSON.stringify({fixtures:golden.length,frames,freeFrames:free,zeroCurrentFrames:zero,allLegacyResultsByteIdentical:true,oldStrictResponsesAndPayoutsPreserved:true,currentAndPastOnly:true,maxReturnsAtStake1000:[4347,4518],fourDistinctGroups:true},null,2)+'\n');
});

test('All 93312 cluster base grids and 24 free candidates match independent adjacency and collection',()=>{
  const coverage:Record<string,unknown>={};
  for(const game of games){let bases=0,bonus=0,maxGroups=0;const dummy=studioBaseFrame(game,Array(6).fill(0));
    for(let encoded=0;encoded<6**6;encoded++){let n=encoded;const stops=Array.from({length:6},()=>{const stop=n%6;n=Math.floor(n/6);return stop;}),frame=studioBaseFrame(game,stops),paid=studioPayFrame(game,frame,'1000');
      const view:StudioSlotView={kind:'slot',cols:6,rows:STUDIO_INFO[game].rows,grid:paid.grid,wins:paid.wins,history:[paid],stage:'base',step:0,remaining:studioSlotHasBonus(game,frame)?2:0,maxSteps:3,held:[],totalPayoutUnits:paid.payoutUnits};
      const details=studioClusterPresentationDetails(game,frame,0);checkTrace(details,frame,0);assert(validStudioSlotPresentation({version:1,sessionId,phase:1,...details},game,sessionId,1,view));
      bases++;bonus+=Number(studioSlotHasBonus(game,frame));maxGroups=Math.max(maxGroups,details.cluster!.groups.length);
    }
    let free=0;for(let step=1;step<=2;step++)for(let seed=0;seed<6;seed++){const frame=studioBonusFrame(game,dummy,seed,step),details=studioClusterPresentationDetails(game,frame,step);checkTrace(details,frame,step);free++;}
    assert.equal(bases,46656);assert.equal(free,12);assert.equal(bonus,game==='studio-lumen-grove'?46250:46656);assert.equal(maxGroups,game==='studio-lumen-grove'?3:4);
    coverage[game]={bases,free,bonus,maxGroups};
  }
  writeFileSync(directory+'/metadata-mechanics-proof.json',JSON.stringify({coverage,totalBaseGrids:93312,totalCurrentFreeCandidates:24,independentOrthogonalGroups:true,exactCoinAndCollectorMapping:true,exactCurrentCellValuesAndGroupSums:true},null,2)+'\n');
});

test('Cluster validator rejects forged components, collectors, cell factors, private and stale payloads',()=>{
  for(const fixture of golden)for(const result of fixture.results){const value=payload(fixture.gameId,result),view=result.studio as StudioSlotView,cluster=value.cluster!;
    const mutations:unknown[]=[{...value,seeds:fixture.seeds},{...value,version:2},{...value,sessionId:'88888888-8888-4888-8888-888888888888'},{...value,phase:phase(result)%3+1},{...value,step:(view.step+1)%3},{...value,cluster:undefined},{...value,cluster:{...cluster,seeds:[0,0]}},{...value,beforeGrid:value.beforeGrid.map(()=>0)},{...value,afterGrid:value.afterGrid.map(()=>0)},{...value,cascade:{}},{...value,events:[{kind:'sticky-wild',positions:[0]}]},{...value,heldAfter:[0]}];
    if(cluster.groups.length){const group=cluster.groups[0];mutations.push({...value,cluster:{...cluster,groups:cluster.groups.slice(1)}},{...value,cluster:{...cluster,groups:cluster.groups.map((item,i)=>i?item:{...group,winIndex:99})}},{...value,cluster:{...cluster,groups:cluster.groups.map((item,i)=>i?item:{...group,positions:[...group.positions.slice(1),group.positions[0]+1]})}});}
    if(cluster.collects.length){const collect=cluster.collects[0];mutations.push({...value,cluster:{...cluster,collects:cluster.collects.slice(1)}},{...value,cluster:{...cluster,collects:cluster.collects.map((item,i)=>i?item:{...collect,collector:collect.collector+1})}},{...value,cluster:{...cluster,collects:cluster.collects.map((item,i)=>i?item:{...collect,coins:collect.coins.slice(1)})}},{...value,cluster:{...cluster,collects:cluster.collects.map((item,i)=>i?item:{...collect,coins:collect.coins.map((coin,k)=>k?coin:{...coin,rawValue:99})})}});}
    if(cluster.cellValues.length)mutations.push({...value,cluster:{...cluster,cellValues:cluster.cellValues.slice(1)}},{...value,cluster:{...cluster,cellValues:cluster.cellValues.map((item,i)=>i?item:{...item,value:item.value%3+1})}});
    if(cluster.groupFactors.length)mutations.push({...value,cluster:{...cluster,groupFactors:cluster.groupFactors.map((item,i)=>i?item:{...item,factor:item.factor+1})}});
    for(const mutation of mutations)if(JSON.stringify(mutation)!==JSON.stringify(value))assert(!validStudioSlotPresentation(mutation,fixture.gameId,sessionId,phase(result),view));
  }
  const four=golden.find(f=>f.name==='fourClusters')!,result=four.results[0],value=payload(four.gameId,result),first=value.cluster!.groups[0],second=value.cluster!.groups[1];
  const merged={...value,cluster:{...value.cluster!,groups:[{...first,count:first.count+second.count,positions:[...first.positions,...second.positions]},...value.cluster!.groups.slice(2)]}};
  assert(!validStudioSlotPresentation(merged,four.gameId,sessionId,phase(result),result.studio as StudioSlotView));
});

test('Previous four presentation games retain exact payload bytes for all 64 golden frames',()=>{
  const old=JSON.parse(readFileSync(new URL('./fixtures/studio-cluster-legacy-metadata-v1.json',import.meta.url),'utf8')) as {gameId:Parameters<typeof currentStudioSlotPresentation>[0];result:StudioResult;metadata:StudioSlotPresentationFrame}[];
  for(const fixture of old){const value=currentStudioSlotPresentation(fixture.gameId,fixture.result.engine);assert.equal(JSON.stringify(value),JSON.stringify(fixture.metadata));assert(validStudioSlotPresentation({version:1,sessionId,phase:phase(fixture.result),...value},fixture.gameId,sessionId,phase(fixture.result),fixture.result.studio as StudioSlotView));}
  assert.equal(old.length,64);writeFileSync(directory+'/old-presentation-compatibility.json',JSON.stringify({games:4,frames:old.length,exactPayloadBytes:true},null,2)+'\n');
});
