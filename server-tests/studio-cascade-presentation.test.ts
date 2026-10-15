import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {STUDIO_DEFAULTS,studioScore,studioBonusFrame,studioCascadePresentationDetails,validStudioEnvelope,validStudioSettlement,validStudioSlotPresentation,type StudioCascadePresentationGameId,type StudioRawFrame,type StudioSlotView,type StudioSlotPresentationFrame} from '../src/shared/studioGames';
import {startStudioGame,moveStudioGame,currentStudioSlotPresentation,type StudioResult} from '../server/games/studioGames';

const directory='artifacts/studio-wave3-20261012';
const games:StudioCascadePresentationGameId[]=['studio-caramel-carnival','studio-starfall-oracle'];
const sessionId='55555555-5555-4555-8555-555555555555';
type Fixture={name:string;gameId:StudioCascadePresentationGameId;stops:number[];seeds:number[];results:StudioResult[];transitions:{fromStep:number;step:number;beforeGrid:number[];afterGrid:number[];removedPositions:number[];drops:{from:number;to:number;symbol:number}[];refills:{position:number;symbol:number}[];orbFactorBefore:number;orbFactorAfter:number;addedOrbPositions:number[]}[]};
const golden=JSON.parse(readFileSync(new URL('./fixtures/studio-cascade-presentation-v1.json',import.meta.url),'utf8')) as Fixture[];
const phase=(result:StudioResult)=>result.ended?1:(result.studio as StudioSlotView).step+1;
function payload(game:StudioCascadePresentationGameId,result:StudioResult){return {version:1 as const,sessionId,phase:phase(result),...currentStudioSlotPresentation(game,result.engine)};}
function envelope(result:StudioResult){return {studio:result.studio,player:[],dealer:[],community:[],actions:result.ended?[]:[{move:'studio-spin',label:'Продолжить бесплатный бонус',cost:0}],phase:phase(result),ended:result.ended,message:result.message};}
function checkTrace(details:StudioSlotPresentationFrame,previous:StudioRawFrame|null,current:StudioRawFrame,seed?:number){
  const trace=details.cascade!;assert(trace);
  assert.deepEqual(details.beforeGrid,previous?.grid??current.grid);assert.deepEqual(details.afterGrid,current.grid);
  assert.deepEqual([details.heldBefore,details.heldAfter,details.events,details.multipliers],[[],[],[],[]]);
  assert.equal(trace.fromStep,previous?details.step-1:null);
  const expectedGroups=current.wins.map((win,winIndex)=>({winIndex,symbol:win.symbol,count:win.count,positions:win.positions}));
  assert.deepEqual(trace.groups,expectedGroups);
  for(const group of trace.groups){assert.equal(group.count,group.positions.length);assert(group.count>=8);assert(group.positions.every(position=>current.grid[position]===group.symbol));}
  if(previous){
    const removed=[...new Set(previous.wins.flatMap(win=>win.positions))].sort((a,b)=>a-b);
    assert.deepEqual(trace.removedPositions,removed);
    const removedSet=new Set(removed),expectedDrops:typeof trace.drops=[],expectedRefills:typeof trace.refills=[],grid=Array(30).fill(-1);
    for(let col=0;col<6;col++){
      const cells=Array.from({length:5},(_,row)=>row*6+col).filter(position=>!removedSet.has(position));
      cells.forEach((from,index)=>{const to=(5-cells.length+index)*6+col,symbol=previous.grid[from];expectedDrops.push({from,to,symbol});grid[to]=symbol;assert(to>=from);});
      for(let row=0;row<5-cells.length;row++){const position=row*6+col,symbol=[0,0,1,1,2,5][(seed!+row+col+details.step+col*2)%6];expectedRefills.push({position,symbol});grid[position]=symbol;}
    }
    assert.deepEqual(trace.drops,expectedDrops);assert.deepEqual(trace.refills,expectedRefills);assert.deepEqual(grid,current.grid);
    assert.equal(trace.refills.length,removed.length);assert.equal(new Set([...trace.drops.map(item=>item.to),...trace.refills.map(item=>item.position)]).size,30);
    assert.equal(new Set([...trace.drops.map(item=>item.from),...removed]).size,30);
  }else assert.deepEqual([trace.removedPositions,trace.drops,trace.refills,trace.addedOrbPositions],[[],[],[],[]]);
  if(details.gameId==='studio-starfall-oracle'){
    const orbPositions=current.grid.flatMap((symbol,position)=>symbol===5?[position]:[]),beforeOrbs=(previous?.grid??current.grid).filter(symbol=>symbol===5).length;
    assert.deepEqual(trace.orbPositions,orbPositions);assert.equal(trace.orbFactor,1+orbPositions.length);assert.equal(trace.orbFactorBefore,1+beforeOrbs);
    assert.deepEqual(trace.addedOrbPositions,trace.refills.filter(item=>item.symbol===5).map(item=>item.position));
    assert(trace.orbFactor>=trace.orbFactorBefore);assert.equal(orbPositions.length,beforeOrbs+trace.addedOrbPositions.length);
    current.wins.forEach(win=>assert.equal(win.raw,(win.count-7)*(win.symbol+2)*4*trace.orbFactor));
  }else{assert.deepEqual(trace.orbPositions,[]);assert.deepEqual(trace.addedOrbPositions,[]);assert.equal(trace.orbFactor,1);assert.equal(trace.orbFactorBefore,1);}
  assert(!/"(engine|seeds|seed|stops|settings|createdAt|balance|raw|payoutUnits|totalPayoutUnits)"/.test(JSON.stringify(details)));
}

test('Cascade metadata preserves all 20 golden v1 games, strict envelopes and exact payouts',()=>{
  let frames=0,early=0;
  for(const fixture of golden){let calls=0,draws=[...fixture.stops,...fixture.seeds],result=startStudioGame(fixture.gameId,STUDIO_DEFAULTS[fixture.gameId],'1000',()=>{calls++;return draws.shift()!;});
    for(let step=0;step<fixture.results.length;step++){
      assert.equal(JSON.stringify(result),JSON.stringify(fixture.results[step]));
      assert(validStudioSettlement(fixture.gameId,result.ended?'settled':'active','1000','1000',String(result.credit),result.studio));
      assert(validStudioEnvelope(fixture.gameId,result.ended?'settled':'active',envelope(result)));
      const before=JSON.stringify(result),metadata=payload(fixture.gameId,result),view=result.studio as StudioSlotView;
      assert(validStudioSlotPresentation(metadata,fixture.gameId,sessionId,phase(result),view));
      checkTrace(metadata,step?view.history[step-1]:null,view.history[step],step?fixture.seeds[step-1]:undefined);
      if(step){const expected=fixture.transitions[step-1],actual=metadata.cascade!;assert.deepEqual(actual.removedPositions,expected.removedPositions);assert.deepEqual(actual.drops,expected.drops);assert.deepEqual(actual.refills,expected.refills);assert.equal(actual.orbFactor,expected.orbFactorAfter);}
      assert.equal(JSON.stringify(result),before);assert.equal(calls,8);frames++;
      assert.equal(Object.keys(view).sort().join(),'cols,grid,held,history,kind,maxSteps,remaining,rows,stage,step,totalPayoutUnits,wins');
      const future=structuredClone(result.engine) as {seeds:number[]};
      if(step===0){future.seeds=[5,4];assert.deepEqual(currentStudioSlotPresentation(fixture.gameId,future),currentStudioSlotPresentation(fixture.gameId,result.engine));}
      if(step===1){future.seeds[1]=(future.seeds[1]+1)%6;assert.deepEqual(currentStudioSlotPresentation(fixture.gameId,future),currentStudioSlotPresentation(fixture.gameId,result.engine));}
      if(result.ended&&step===1){early++;assert.equal(phase(result),1);assert.throws(()=>currentStudioSlotPresentation(fixture.gameId,{...future,step:2}),/presentation step/);}
      if(!result.ended)result=moveStudioGame(fixture.gameId,result.engine,'studio-spin',undefined,'1000');
    }
  }
  assert.equal(golden.length,20);assert(early>=2);
  mkdirSync(directory,{recursive:true});writeFileSync(directory+'/metadata-golden-proof.json',JSON.stringify({fixtures:golden.length,frames,earlyEndFrames:early,mainResponsesByteIdentical:true,currentAndPastOnly:true,payoutsUnchanged:true},null,2)+'\n');
});

test('All 341520 reachable gravity/refill transitions have exact current-frame traces for both games',()=>{
  const states=gunzipSync(readFileSync(new URL('./fixtures/studio-cascade-grids-v1.jsonl.gz',import.meta.url))).toString().trim().split('\n').map(line=>JSON.parse(line) as {step:number;grid:number[];continues:boolean});
  const coverage:Record<string,number>={};
  for(const game of games){let checked=0;
    for(const state of states){if(state.step>=2||!state.continues)continue;
      const wins=studioScore(game,state.grid,state.step),previous:StudioRawFrame={stage:state.step?'tumble':'base',grid:state.grid,wins,raw:wins.reduce((sum,win)=>sum+win.raw,0),held:[]};
      for(let seed=0;seed<6;seed++){
        const current=studioBonusFrame(game,previous,seed,state.step+1),details=studioCascadePresentationDetails(game,previous,current,state.step+1);
        checkTrace(details,previous,current,seed);checked++;
      }
    }
    assert.equal(checked,341520);coverage[game]=checked;
  }
  writeFileSync(directory+'/metadata-transition-proof.json',JSON.stringify({transitionsPerGame:341520,coverage,total:683040,independentRemovalGravityStripRefillGroupsAndOrbs:true},null,2)+'\n');
});

test('Cascade validator rejects forged groups, maps, factors, stale steps and private extensions',()=>{
  for(const fixture of golden)for(const result of fixture.results){
    const value=payload(fixture.gameId,result),view=result.studio as StudioSlotView,cascade=value.cascade!;
    const mutations:unknown[]=[{...value,seeds:fixture.seeds},{...value,version:2},{...value,sessionId:'66666666-6666-4666-8666-666666666666'},{...value,phase:phase(result)%3+1},{...value,step:(view.step+1)%3},{...value,cascade:undefined},{...value,beforeGrid:value.beforeGrid.map(()=>0)},{...value,afterGrid:value.afterGrid.map(()=>0)},{...value,events:[{kind:'sticky-wild',positions:[0]}]},{...value,cascade:{...cascade,seed:5}},{...value,cascade:{...cascade,groups:[]}},{...value,cascade:{...cascade,fromStep:99}},{...value,cascade:{...cascade,orbFactor:99}},{...value,cascade:{...cascade,orbPositions:[-1]}},{...value,cascade:{...cascade,addedOrbPositions:[29]}}];
    if(cascade.removedPositions.length)mutations.push({...value,cascade:{...cascade,removedPositions:cascade.removedPositions.slice(1)}});
    if(cascade.drops.length)mutations.push({...value,cascade:{...cascade,drops:cascade.drops.map((item,index)=>index?item:{...item,to:(item.to+1)%30})}});
    if(cascade.refills.length)mutations.push({...value,cascade:{...cascade,refills:cascade.refills.map((item,index)=>index?item:{...item,symbol:(item.symbol+1)%6})}});
    for(const mutation of mutations)if(JSON.stringify(mutation)!==JSON.stringify(value))assert(!validStudioSlotPresentation(mutation,fixture.gameId,sessionId,phase(result),view));
  }
});
