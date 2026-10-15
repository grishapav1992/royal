import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {STUDIO_INFO,STUDIO_DEFAULTS,studioBaseFrame,studioBonusFrame,studioPayFrame,studioSlotHasBonus,validStudioEnvelope,validStudioSettlement,validStudioSlotPresentation,type StudioElementPresentationGameId,type StudioRawFrame,type StudioSlotView,type StudioSlotPresentationFrame} from '../src/shared/studioGames';
import {startStudioGame,moveStudioGame,currentStudioSlotPresentation,type StudioResult} from '../server/games/studioGames';

const directory='artifacts/studio-wave5-20261012',sessionId='77777777-7777-4777-8777-777777777777';
const games:StudioElementPresentationGameId[]=['studio-stormforge-duel','studio-saffron-cipher','studio-beacon-bay'];
const strips=[[0,1,2,3,4,5],[1,0,2,4,3,5],[2,1,0,5,4,3],[0,2,1,3,5,4],[1,2,0,4,5,3]];
type Fixture={name:string;gameId:StudioElementPresentationGameId;stops:number[];seeds:number[];results:StudioResult[];metadata:StudioSlotPresentationFrame[]};
const golden=JSON.parse(readFileSync(new URL('./fixtures/studio-element-presentation-v1.json',import.meta.url),'utf8')) as Fixture[];
const phase=(result:StudioResult)=>result.ended?1:(result.studio as StudioSlotView).step+1;
const payload=(game:StudioElementPresentationGameId,result:StudioResult)=>({version:1 as const,sessionId,phase:phase(result),...currentStudioSlotPresentation(game,result.engine)});
const rawGrid=(stops:number[],step=0,seed=0)=>Array.from({length:15},(_,position)=>{const column=position%5,row=Math.floor(position/5);return strips[column][(step?seed*(column+1)+row+step+column:stops[column]+row)%6];});

function independent(game:StudioElementPresentationGameId,before:number[],step:number){
  const grid=[...before],events:StudioSlotPresentationFrame['events']=[],symbol=(before[0]<3?before[0]:0) as 0|1|2;
  const matchingColumns=[0,1,2,3,4].filter(column=>[before[column],before[column+5],before[column+10]].includes(symbol));
  const chosen={symbol,sourcePosition:0 as const,sourceSymbol:before[0],matchingColumns,active:matchingColumns.length>=3};
  for(let column=0;column<5;column++){
    const positions=[column,column+5,column+10],native=positions.filter(position=>before[position]===3);
    const active=game==='studio-stormforge-duel'?native.length>0:game==='studio-beacon-bay'?before[column+5]===3:chosen.active&&matchingColumns.includes(column);
    if(active){positions.forEach(position=>{grid[position]=3;});events.push({kind:game==='studio-stormforge-duel'?'expand-wild':game==='studio-beacon-bay'?'beam-wild':'chosen-wild',column,positions,sourcePositions:game==='studio-stormforge-duel'?native:game==='studio-beacon-bay'?[column+5]:positions.filter(position=>before[position]===symbol)});}
  }
  const wins:StudioRawFrame['wins']=[];
  for(let line=0;line<STUDIO_INFO[game].paylines.length;line++){
    const positions=STUDIO_INFO[game].paylines[line].map((row,column)=>row*5+column);let best:StudioRawFrame['wins'][number]|undefined;
    for(let candidate=0;candidate<3;candidate++){
      let count=0;while(count<5&&(grid[positions[count]]===candidate||grid[positions[count]]===3))count++;
      if(count<3)continue;
      const prefix=positions.slice(0,count),wilds=prefix.filter(position=>grid[position]===3).length;
      const factor=game==='studio-stormforge-duel'?1+Math.min(3,wilds):1,raw=({3:2,4:6,5:18}[count]!)*(candidate+2)*factor;
      if(!best||raw>best.raw)best={kind:'line',symbol:candidate,positions:prefix,count,line,raw};
    }
    if(best)wins.push(best);
  }
  const multipliers:StudioSlotPresentationFrame['multipliers']=[];
  if(game==='studio-stormforge-duel')wins.forEach((win,winIndex)=>{const positions=win.positions.filter(position=>grid[position]===3);if(positions.length)multipliers.push({winIndex,line:win.line!,factor:(1+Math.min(3,positions.length)) as 2|3|4,positions});});
  const details:StudioSlotPresentationFrame={gameId:game,step,stage:step?'free-spin':'base',beforeGrid:before,afterGrid:grid,heldBefore:[],heldAfter:[],events,multipliers,...(game==='studio-saffron-cipher'?{chosen}:{})};
  return {details,wins};
}
function check(game:StudioElementPresentationGameId,before:number[],step:number,frame:StudioRawFrame,details:StudioSlotPresentationFrame){
  const expected=independent(game,before,step);assert.deepEqual(frame.grid,expected.details.afterGrid);assert.deepEqual(frame.wins.map(({kind,symbol,positions,count,line,raw})=>({kind,symbol,positions,count,line,raw})),expected.wins);
  assert.deepEqual(details,expected.details);
  assert(!/"(engine|seeds|seed|stops|settings|balance|raw|payoutUnits|totalPayoutUnits)"/.test(JSON.stringify(details)));
}
function savedView(game:StudioElementPresentationGameId,history:ReturnType<typeof studioPayFrame>[],step:number):StudioSlotView{
  const last=history[step];return {kind:'slot',cols:5,rows:3,grid:last.grid,wins:last.wins,history,stage:last.stage,step,remaining:studioSlotHasBonus(game,history[0])?2-step:0,maxSteps:3,held:[],totalPayoutUnits:history.reduce((sum,frame)=>sum+BigInt(frame.payoutUnits),0n).toString()};
}

test('Element metadata preserves 28 reachable golden rounds and all 44 strict monetary frames',()=>{
  let frames=0,free=0,privateVariants=0;
  mkdirSync(directory,{recursive:true});
  for(const fixture of golden){let calls=0,draws=[...fixture.stops,...fixture.seeds];let result=startStudioGame(fixture.gameId,STUDIO_DEFAULTS[fixture.gameId],'1000',()=>{calls++;return draws.shift()!;});
    for(let step=0;step<fixture.results.length;step++){
      assert.equal(JSON.stringify(result),JSON.stringify(fixture.results[step]));assert.equal(calls,7);
      const view=result.studio as StudioSlotView,metadata=payload(fixture.gameId,result),before=JSON.stringify(result);
      assert(validStudioSettlement(fixture.gameId,result.ended?'settled':'active','1000','1000',String(result.credit),view));
      assert(validStudioEnvelope(fixture.gameId,result.ended?'settled':'active',{studio:view,player:[],dealer:[],community:[],actions:result.ended?[]:[{move:'studio-spin',label:'Продолжить бесплатный бонус',cost:0}],phase:phase(result),ended:result.ended,message:result.message}));
      assert(validStudioSlotPresentation(metadata,fixture.gameId,sessionId,phase(result),view));
      assert.equal(JSON.stringify(currentStudioSlotPresentation(fixture.gameId,result.engine)),JSON.stringify(fixture.metadata[step]));
      const raw=studioBaseFrame(fixture.gameId,fixture.stops),current=step?studioBonusFrame(fixture.gameId,raw,fixture.seeds[step-1],step):raw;
      check(fixture.gameId,rawGrid(fixture.stops,step,step?fixture.seeds[step-1]:0),step,current,fixture.metadata[step]);
      const engine=result.engine as {seeds:number[]};
      if(step===0)for(let first=0;first<6;first++)for(let second=0;second<6;second++){
        assert.deepEqual(currentStudioSlotPresentation(fixture.gameId,{...engine,seeds:[first,second]}),fixture.metadata[step]);privateVariants++;
      }
      if(step===1)for(let seed=0;seed<6;seed++){
        assert.deepEqual(currentStudioSlotPresentation(fixture.gameId,{...engine,seeds:[engine.seeds[0],seed]}),fixture.metadata[step]);privateVariants++;
      }
      assert.equal(JSON.stringify(result),before);assert.equal(view.held.length,0);assert.equal(view.stage,step?'free-spin':'base');
      assert.equal(Object.keys(view).sort().join(),'cols,grid,held,history,kind,maxSteps,remaining,rows,stage,step,totalPayoutUnits,wins');
      if(step)free++;frames++;
      if(!result.ended)result=moveStudioGame(fixture.gameId,result.engine,'studio-spin',undefined,'1000');
    }
  }
  assert.deepEqual(golden.filter(f=>f.name==='maximum').map(f=>f.results.at(-1)!.credit),[5214,4450,10720]);
  assert.equal(golden.find(f=>f.name==='zeroFinalFree')!.results.at(-1)!.credit,28);
  writeFileSync(directory+'/metadata-golden-proof.json',JSON.stringify({fixtures:golden.length,frames,freeFrames:free,unusedSeedVariants:privateVariants,allLegacyResultsByteIdentical:true,strictMonetaryResponsesAndPayoutsPreserved:true,currentAndPastOnly:true,maxReturnsAtStake1000:[5214,4450,10720]},null,2)+'\n');
});

test('All 230850 reachable element current-frame projections match independent transforms and line facts',()=>{
  const coverage:Record<string,unknown>={};let allFrames=0;
  for(const game of games){let bases=0,bonus=0,first=0,second=0;const dummy=studioBaseFrame(game,[0,0,0,0,0]);
    const free=[1,2].map(step=>Array.from({length:6},(_,seed)=>{const raw=studioBonusFrame(game,dummy,seed,step),paid=studioPayFrame(game,raw,'1000'),details=independent(game,rawGrid([],step,seed),step).details;check(game,rawGrid([],step,seed),step,raw,details);return {raw,paid,details};}));
    for(let encoded=0;encoded<6**5;encoded++){
      let n=encoded;const stops=Array.from({length:5},()=>{const stop=n%6;n=Math.floor(n/6);return stop;}),base=studioBaseFrame(game,stops),paid=studioPayFrame(game,base,'1000');
      const engine={kind:'studio-slot',stops,seeds:[0,0],step:0,ended:!studioSlotHasBonus(game,base)},details=currentStudioSlotPresentation(game,engine);
      check(game,rawGrid(stops),0,base,details);assert(validStudioSlotPresentation({version:1,sessionId,phase:1,...details},game,sessionId,1,savedView(game,[paid],0)));bases++;
      if(!studioSlotHasBonus(game,base))continue;bonus++;
      for(let seed=0;seed<6;seed++){
        const one=currentStudioSlotPresentation(game,{...engine,seeds:[seed,0],step:1,ended:false});assert.deepEqual(one,free[0][seed].details);
        assert(validStudioSlotPresentation({version:1,sessionId,phase:2,...one},game,sessionId,2,savedView(game,[paid,free[0][seed].paid],1)));first++;
        for(let next=0;next<6;next++){
          const two=currentStudioSlotPresentation(game,{...engine,seeds:[seed,next],step:2,ended:true});assert.deepEqual(two,free[1][next].details);
          assert(validStudioSlotPresentation({version:1,sessionId,phase:1,...two},game,sessionId,1,savedView(game,[paid,free[0][seed].paid,free[1][next].paid],2)));second++;
        }
      }
    }
    assert.equal(bases,7776);assert.equal(bonus,{ 'studio-stormforge-duel':636,'studio-saffron-cipher':1857,'studio-beacon-bay':2448 }[game]);
    allFrames+=bases+first+second;coverage[game]={bases,bonus,firstFreeFrames:first,secondFreeFrames:second,currentFreeCandidates:12};
  }
  assert.equal(allFrames,230850);writeFileSync(directory+'/metadata-mechanics-proof.json',JSON.stringify({coverage,totalReachableFrameProjections:allFrames,independentRawGridTransformsAndBestLineScoring:true,exactPaidPrefixFactors:true,exactChosenThresholdAndFallback:true,exactMiddleOnlyBeamSources:true,allValidatorProjectionsAccepted:true},null,2)+'\n');
});

test('Element metadata rejects forged sources, chosen facts, factors, held pins, private and stale fields',()=>{
  let rejected=0;
  for(const fixture of golden)for(const result of fixture.results){const value=payload(fixture.gameId,result),view=result.studio as StudioSlotView;
    const mutations:unknown[]=[{...value,seeds:fixture.seeds},{...value,version:2},{...value,sessionId:'88888888-8888-4888-8888-888888888888'},{...value,phase:phase(result)%3+1},{...value,step:(view.step+1)%3},{...value,beforeGrid:value.beforeGrid.map(()=>0)},{...value,afterGrid:value.afterGrid.map(()=>0)},{...value,cascade:{}},{...value,cluster:{}},{...value,heldAfter:[0]}];
    if(value.events.length){const event=value.events[0];if(event.kind!=='sticky-wild')mutations.push({...value,events:value.events.slice(1)},{...value,events:[{...event,kind:event.kind==='beam-wild'?'expand-wild':'beam-wild'},...value.events.slice(1)]},{...value,events:[{...event,sourcePositions:[(event.sourcePositions[0]+1)%15]},...value.events.slice(1)]});}
    if(value.chosen)mutations.push({...value,chosen:undefined},{...value,chosen:{...value.chosen,symbol:(value.chosen.symbol+1)%3}},{...value,chosen:{...value.chosen,active:!value.chosen.active}},{...value,chosen:{...value.chosen,sourcePosition:1}},{...value,chosen:{...value.chosen,matchingColumns:value.chosen.matchingColumns.slice(1)}},{...value,chosen:{...value.chosen,seeds:[0,0]}});
    else mutations.push({...value,chosen:{symbol:0,sourcePosition:0,sourceSymbol:0,matchingColumns:[],active:false}});
    if(value.multipliers.length){const factor=value.multipliers[0];mutations.push({...value,multipliers:value.multipliers.slice(1)},{...value,multipliers:[{...factor,winIndex:99},...value.multipliers.slice(1)]},{...value,multipliers:[{...factor,factor:factor.factor===4?2:4},...value.multipliers.slice(1)]},{...value,multipliers:[{...factor,positions:factor.positions.slice(1)},...value.multipliers.slice(1)]});}
    for(const mutation of mutations)if(JSON.stringify(mutation)!==JSON.stringify(value)){assert(!validStudioSlotPresentation(mutation,fixture.gameId,sessionId,phase(result),view));rejected++;}
  }
  writeFileSync(directory+'/metadata-validation-proof.json',JSON.stringify({rejectedMutations:rejected,strictKeysSourcesChosenFactorsAndCurrentIdentity:true},null,2)+'\n');
});

test('Six previous metadata games retain exact bytes and strict validators on 90 frozen frames',()=>{
  const old=JSON.parse(readFileSync(new URL('./fixtures/studio-element-legacy-metadata-v1.json',import.meta.url),'utf8')) as {gameId:Parameters<typeof currentStudioSlotPresentation>[0];result:StudioResult;metadata:StudioSlotPresentationFrame}[];
  for(const fixture of old){const value=currentStudioSlotPresentation(fixture.gameId,fixture.result.engine);assert.equal(JSON.stringify(value),JSON.stringify(fixture.metadata));assert(validStudioSlotPresentation({version:1,sessionId,phase:phase(fixture.result),...value},fixture.gameId,sessionId,phase(fixture.result),fixture.result.studio as StudioSlotView));}
  assert.equal(old.length,90);writeFileSync(directory+'/old-presentation-compatibility.json',JSON.stringify({games:6,frames:90,exactPayloadBytes:true},null,2)+'\n');
});
