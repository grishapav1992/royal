import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rebuildTempleView} from '../src/shared/floodedTemple';
import {templeAllBaseCases,templeEdgeKey} from '../src/shared/floodedTempleMath';
import {templePlan,templeOutcome} from '../games/flooded-temple/presentation';
import {readTempleClock,contextTimeForAccent} from '../games/flooded-temple/audioClock';
import {renderCue,metrics,wav,rate} from '../scripts/design/temple-audio.mjs';
import {templeReaction} from '../games/flooded-temple/character';

test('every base presentation follows only confirmed passages and reaches the exact collected amount',()=>{
  for(const base of templeAllBaseCases()){
    const view=rebuildTempleView(base,base.relic?{layout:0,tier:0}:null,'1000'),plan=templePlan('base',view,undefined);
    let last=0n;
    for(const beat of plan.beats){
      assert(BigInt(beat.frame.totalUnits)>=last);last=BigInt(beat.frame.totalUnits);
      if(beat.kind==='travel'){const map=beat.frame.mode==='base'?view.baseMap:view.bonusMap!,edge=map.edges.find(e=>templeEdgeKey(e.a,e.b)===templeEdgeKey(beat.from!,beat.room!));assert(edge);assert(edge.kind==='open'||beat.frame.opened.includes(templeEdgeKey(edge.a,edge.b))||beat.frame.bridge===templeEdgeKey(edge.a,edge.b));}
      if(beat.cue==='win'||beat.cue==='big')assert(BigInt(view.totalPayoutUnits)>BigInt(view.stakeUnits));
    }
    assert.equal(plan.final.totalUnits,view.totalPayoutUnits);assert.equal(plan.beats.at(-1)!.frame.totalUnits,view.totalPayoutUnits);
  }
});
test('rope attaches before movement, revisits never collect again and the sixth move collects before settlement',()=>{
  let before=rebuildTempleView({layout:0,pattern:0,tier:0,relic:true},{layout:0,tier:0},'1000');
  const actions=[{kind:'step',to:6},{kind:'step',to:11},{kind:'rope',to:12},{kind:'step',to:13},{kind:'step',to:8},{kind:'step',to:9}]as const;
  for(const action of actions){const view=rebuildTempleView(before.baseCase,before.bonusCase,'1000',[...before.history,action]),plan=templePlan('move',view,before);
    if(action.kind==='rope'){assert.equal(plan.beats[0].kind,'rope');assert.equal(plan.beats[0].frame.ropeAvailable,false);assert.equal(plan.beats[1].kind,'travel');}
    if(view.phase==='complete'){assert.equal(plan.beats.at(-1)!.kind,'outcome');assert(plan.beats.findIndex(b=>b.kind==='collect')<plan.beats.findIndex(b=>b.kind==='outcome'));assert.equal(plan.final.totalUnits,'1750');}
    before=view;
  }
  const base=rebuildTempleView(before.baseCase,before.bonusCase,'1000',[{kind:'step',to:6},{kind:'step',to:7},{kind:'step',to:6}]);
  const repeated=rebuildTempleView(base.baseCase,base.bonusCase,'1000',[...base.history,{kind:'step',to:7}]);assert(!templePlan('repeat',repeated,base).beats.some(b=>b.kind==='collect'));
});
test('outcome hierarchy uses the full original stake and reduced motion has no travel or effect burst',()=>{
  for(const [payout,kind]of[['0','loss'],['999','partial'],['1000','return'],['1001','win'],['4999','win'],['5000','big']])assert.equal(templeOutcome('1000',payout),kind);
  const view=rebuildTempleView({layout:0,pattern:0,tier:0,relic:true},{layout:0,tier:0},'1000');
  const reduced=templePlan('reduced',view,undefined,true);assert.equal(reduced.beats.length,1);assert.equal(reduced.beats[0].kind,'summary');assert.equal(reduced.final.mode,'bonus');assert.deepEqual(reduced.final.visited,[5]);
});

test('quick presentation preserves the exact full round and only condenses confirmed feedback',()=>{
  for(const base of templeAllBaseCases()){
    const view=rebuildTempleView(base,base.relic?{layout:0,tier:0}:null,'1000');
    const normal=templePlan('normal',view,undefined),quick=templePlan('quick',view,undefined,false,true);
    assert.deepEqual(quick.final,normal.final);assert.equal(quick.beats.length,1);assert.equal(quick.beats[0].kind,'summary');assert.equal(quick.quick,true);assert.equal(quick.reduced,false);assert(quick.duration<=800);
    if(view.phase==='complete')assert.equal(quick.beats[0].outcome,templeOutcome(view.stakeUnits,view.totalPayoutUnits));
    else assert.equal(quick.beats[0].cue,'relic');
    assert.equal(templePlan('both',view,undefined,true,true).duration,180);
  }
});

test('character reactions never celebrate a partial return, waiting, recovery or a route choice',()=>{
  const view=rebuildTempleView({layout:0,pattern:0,tier:0,relic:true},{layout:0,tier:0},'1000');
  for(const beat of templePlan('poses',view,undefined).beats){
    const reaction=templeReaction(beat);
    assert.notEqual(reaction.pose,'celebrate');
    if(beat.kind==='relic')assert.equal(reaction.pose,'discover');
    if(beat.kind==='gate')assert.equal(reaction.pose,'brace');
  }
  const summary=templePlan('reduced',view,undefined,true).beats[0];
  for(const outcome of ['loss','partial','return','win','big'] as const){const reaction=templeReaction({...summary,kind:'outcome',outcome});assert.equal(reaction.pose,outcome==='win'||outcome==='big'?'celebrate':outcome==='return'?'idle':'reflect');}
  assert.equal(templeReaction(undefined,true).pose,'observe');
  assert.equal(templeReaction(undefined,false,true).clip,'prepare-rope');
  assert.equal(templeReaction(undefined,false,false,true).pose,'observe');
  assert.equal(templeReaction(undefined).pose,'idle');
});
test('audio mapping uses the output timestamp once and subtracts estimated latency only in fallback',()=>{
  const context={state:'running',currentTime:10,outputLatency:.1,baseLatency:.02,getOutputTimestamp:()=>({contextTime:9.86,performanceTime:1000})}as AudioContext;
  const clock=readTempleClock(context,1020);assert.equal(clock.method,'output-timestamp');assert.equal(contextTimeForAccent(clock,1300,.16),10);
  const fallback=readTempleClock({...context,getOutputTimestamp:undefined}as unknown as AudioContext,1000);assert.equal(fallback.method,'latency-estimate');assert(Math.abs(contextTimeForAccent(fallback,1300,.16)-10.02)<1e-10);
  assert.equal(readTempleClock(undefined,1).method,'silent');
  assert.equal(readTempleClock({...context,getOutputTimestamp:()=>{throw Error('Unavailable device clock');}}as AudioContext,1000).method,'latency-estimate');
  assert.equal(readTempleClock({...context,getOutputTimestamp:()=>({contextTime:9,performanceTime:1})}as AudioContext,1000).method,'latency-estimate');
});
test('recorded WAV mixes match their licensed reproducible sources, have headroom and soft boundaries',()=>{
  const manifest=JSON.parse(readFileSync('games/flooded-temple/sounds.json','utf8'));
  for(const [name,spec]of Object.entries<any>(manifest.cues)){
    const source=renderCue(name),data=readFileSync('public/assets/flooded-temple/audio/'+spec.file),stats=metrics(source.channels);
    assert(data.equals(wav(source.channels)));assert.equal(data.readUInt32LE(24),rate);assert(stats.peak<.31&&stats.rms>.001);assert(spec.accent<spec.duration);
    for(const channel of source.channels){assert(Math.abs(channel[0])<.0001);assert(Math.abs(channel.at(-1)!)<.003);for(const value of channel)assert(Number.isFinite(value));}
  }
  const neutral=metrics(renderCue('neutral').channels),win=metrics(renderCue('win').channels),big=metrics(renderCue('big').channels);assert(neutral.rms<win.rms);assert(big.peak<win.peak*1.2);
});
test('representative dense round mixes keep headroom at full shared volume',()=>{
  const manifest=JSON.parse(readFileSync('games/flooded-temple/sounds.json','utf8'));
  const pack=new Map(Object.keys(manifest.cues).map(name=>[name,renderCue(name)]));
  for(const base of templeAllBaseCases().filter(c=>c.tier===3&&c.pattern===0)){
    const view=rebuildTempleView(base,base.relic?{layout:0,tier:0}:null,'1000'),plan=templePlan('mix',view,undefined),mix=[new Float32Array(Math.ceil((plan.duration/1000+3)*rate)),new Float32Array(Math.ceil((plan.duration/1000+3)*rate))];
    for(const beat of plan.beats){if(!beat.cue)continue;const audio=pack.get(beat.cue)!,offset=Math.floor((.22+(beat.at+(beat.cueAtMs??0))/1000-audio.accent)*rate);for(let c=0;c<2;c++)for(let i=0;i<audio.channels[c].length;i++){const at=offset+i;if(at>=0&&at<mix[c].length)mix[c][at]+=audio.channels[c][i]*.9;}}
    const water=pack.get('ambience')!;for(let c=0;c<2;c++)for(let i=0;i<mix[c].length;i++)mix[c][i]+=water.channels[c][i%water.channels[c].length]*.24*.9;
    assert(metrics(mix).peak<.7);
  }
});
