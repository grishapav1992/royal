import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { STUDIO_DEFAULTS, STUDIO_INFO, studioStrip, validStudioSettlement, validStudioEnvelope, validStudioSlotPresentation, type StudioPresentationGameId, type StudioSlotView, type StudioSlotPresentationFrame } from '../src/shared/studioGames';
import { startStudioGame, moveStudioGame, currentStudioSlotPresentation, type StudioResult } from '../server/games/studioGames';

const games:StudioPresentationGameId[]=['studio-cosmic-escape','studio-velvet-reign'];
const sessionId='33333333-3333-4333-8333-333333333333';
const golden=JSON.parse(readFileSync(new URL('./fixtures/studio-presentation-v1.json',import.meta.url),'utf8')) as {game:StudioPresentationGameId;draws:number[];results:StudioResult[]}[];
const phase=(result:StudioResult)=>result.ended?1:(result.studio as StudioSlotView).step+1;
function envelope(result:StudioResult){return {studio:result.studio,player:[],dealer:[],community:[],actions:result.ended?[]:[{move:'studio-spin',label:'Продолжить бесплатный бонус',cost:0}],phase:phase(result),ended:result.ended,message:result.message};}
function proof(game:StudioPresentationGameId,result:StudioResult):StudioSlotPresentationFrame {
  assert.equal(result.studio.kind,'slot');const view=result.studio as StudioSlotView,details=currentStudioSlotPresentation(game,result.engine),payload={version:1 as const,sessionId,phase:phase(result),...details};
  assert(validStudioSlotPresentation(payload,game,sessionId,phase(result),view));
  assert.deepEqual(details.afterGrid,view.grid);assert.deepEqual(details.heldAfter,view.held);
  const transformed=[...details.beforeGrid];
  for(const event of details.events){
    if(event.kind==='expand-wild'){
      const expected=Array.from({length:STUDIO_INFO[game].rows},(_,row)=>row*5+event.column);
      assert.deepEqual(event.positions,expected);assert.deepEqual(event.sourcePositions,expected.filter(i=>details.beforeGrid[i]===3));assert(event.sourcePositions.length>0);
    }else assert.deepEqual(event.positions,details.heldBefore);
    for(const i of event.positions)transformed[i]=3;
  }
  assert.deepEqual(transformed,view.grid);
  if(game==='studio-velvet-reign'){
    const expectedHeld=[...new Set([...details.heldBefore,...view.grid.flatMap((symbol,i)=>symbol===3?[i]:[])])].sort((a,b)=>a-b);
    assert.deepEqual(details.heldAfter,expectedHeld);
    const expected=view.wins.flatMap((win,winIndex)=>{const positions=win.positions.filter(i=>view.grid[i]===3);return positions.length?[{winIndex,line:win.line!,positions,factor:1+Math.min(3,positions.length)}]:[];});
    assert.deepEqual(details.multipliers,expected);
    for(const item of details.multipliers){const win=view.wins[item.winIndex],length=win.count,base=length===3?2:length===4?6:18;assert.equal(win.raw,(win.symbol+2)*base*item.factor);}
  }else{assert.deepEqual(details.heldBefore,[]);assert.deepEqual(details.heldAfter,[]);assert.deepEqual(details.multipliers,[]);}
  assert(!/"(engine|seeds|stops|settings|createdAt|balance|payoutUnits|totalPayoutUnits)"/.test(JSON.stringify(payload)));
  return details;
}

test('Presentation preserves golden v1 engine, public envelope and payout bytes through every bonus step',()=>{
  for(const fixture of golden){let draws=[...fixture.draws],result=startStudioGame(fixture.game,STUDIO_DEFAULTS[fixture.game],'1000',()=>draws.shift()!);
    for(let step=0;step<fixture.results.length;step++){
      assert.equal(JSON.stringify(result),JSON.stringify(fixture.results[step]));
      assert(validStudioSettlement(fixture.game,result.ended?'settled':'active','1000','1000',String(result.credit),result.studio));
      assert(validStudioEnvelope(fixture.game,result.ended?'settled':'active',envelope(result)));
      const before=JSON.stringify(result);proof(fixture.game,result);assert.equal(JSON.stringify(result),before);
      assert.equal(Object.keys(result.studio).sort().join(),'cols,grid,held,history,kind,maxSteps,remaining,rows,stage,step,totalPayoutUnits,wins');
      assert((result.studio as StudioSlotView).history.every(frame=>Object.keys(frame).sort().join()==='grid,held,payoutUnits,raw,stage,wins'));
      if(!result.ended)result=moveStudioGame(fixture.game,result.engine,'studio-spin',undefined,'1000');
    }
  }
});

test('All base reel stops and every reachable held-state transition map real pre-transform grids to paid grids',()=>{
  const coverage:Record<string,{base:number;bonusStates:number;bonusFrames:number}>={};
  for(const game of games){
    const states=new Map<string,StudioResult>();let base=0,bonusFrames=0;
    for(let code=0;code<6**5;code++){let n=code;const stops=Array.from({length:5},()=>{const stop=n%6;n=Math.floor(n/6);return stop;}),draws=[...stops,0,0];let calls=0;
      const result=startStudioGame(game,STUDIO_DEFAULTS[game],'1000',()=>{calls++;return draws.shift()!;}),details=proof(game,result);base++;
      assert.equal(calls,7);
      assert.deepEqual(details.beforeGrid,Array.from({length:STUDIO_INFO[game].rows*5},(_,i)=>studioStrip(game,i%5)[(stops[i%5]+Math.floor(i/5))%6]));
      const changed=structuredClone(result.engine) as {seeds:number[]};changed.seeds=[5,4];assert.deepEqual(currentStudioSlotPresentation(game,changed),details);
      if(!result.ended)states.set(details.heldAfter.join(),result);
    }
    for(const initial of states.values())for(let first=0;first<6;first++){
      const engine=structuredClone(initial.engine) as {seeds:number[]};engine.seeds=[first,0];
      const next=moveStudioGame(game,engine,'studio-spin',undefined,'1000'),details=proof(game,next);bonusFrames++;
      const future=structuredClone(next.engine) as {seeds:number[]};future.seeds[1]=5;assert.deepEqual(currentStudioSlotPresentation(game,future),details);
      for(let second=0;second<6;second++){
        const lastEngine=structuredClone(next.engine) as {seeds:number[]};lastEngine.seeds[1]=second;
        const last=moveStudioGame(game,lastEngine,'studio-spin',undefined,'1000');proof(game,last);assert(last.ended);bonusFrames++;
      }
    }
    coverage[game]={base,bonusStates:states.size,bonusFrames};
  }
  mkdirSync('artifacts/studio-wave2-20261012',{recursive:true});writeFileSync('artifacts/studio-wave2-20261012/metadata-coverage.json',JSON.stringify(coverage,null,2)+'\n');
});

test('The presentation validator rejects stale, invented or privately extended metadata',()=>{
  for(const fixture of golden)for(const result of fixture.results){
    const game=fixture.game,view=result.studio as StudioSlotView,payload={version:1 as const,sessionId,phase:phase(result),...proof(game,result)};
    const mutations:unknown[]=[{...payload,version:2},{...payload,sessionId:'44444444-4444-4444-8444-444444444444'},{...payload,phase:phase(result)%3+1},{...payload,step:(view.step+1)%3},{...payload,gameId:game==='studio-cosmic-escape'?'studio-velvet-reign':'studio-cosmic-escape'},{...payload,seeds:[0,0]},{...payload,beforeGrid:payload.beforeGrid.slice(1)},{...payload,afterGrid:payload.afterGrid.map(()=>0)},{...payload,heldBefore:[-1]},{...payload,heldAfter:[-1]},{...payload,events:[{kind:'expand-wild',column:0,positions:[0],sourcePositions:[]}]},{...payload,multipliers:[{winIndex:0,line:0,factor:100,positions:[0]}]}];
    for(const mutation of mutations)assert(!validStudioSlotPresentation(mutation,game,sessionId,phase(result),view));
    assert(!validStudioSlotPresentation(null,game,sessionId,phase(result),view));
  }
  assert.throws(()=>currentStudioSlotPresentation('studio-neon-crown' as StudioPresentationGameId,golden[0].results[0].engine),/Unsupported/);
  assert.throws(()=>currentStudioSlotPresentation(games[0],{...golden[0].results[0].engine,seeds:[6,0]}),/private/);
});
