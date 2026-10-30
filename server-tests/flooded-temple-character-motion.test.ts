import test from 'node:test';
import assert from 'node:assert/strict';
import {CharacterMotion,characterMotionTarget,motionChannels} from '../games/flooded-temple/CharacterMotion';
import {templeReaction,type CharacterBeat} from '../games/flooded-temple/character';

const beat=(kind:CharacterBeat['kind'],outcome?:CharacterBeat['outcome']):CharacterBeat=>({id:1,kind,duration:kind==='outcome'?1600:800,outcome,variant:1,multiplier:3});
test('character profiles distinguish cascade, discovery and whole-round result without celebrating partial returns',()=>{
  for(const variant of[0,1,2]){
    const fall=characterMotionTarget('watch-fall',beat('fall'),400,1000,variant),bonus=characterMotionTarget('relic',beat('relic'),400,1000,variant);
    const small=characterMotionTarget('success',beat('outcome','win'),800,1000,variant),big=characterMotionTarget('triumph',beat('outcome','big'),800,1000,variant);
    assert.notDeepEqual(fall,bonus);assert(bonus.leftArm>fall.leftArm);assert.equal(fall.smile,0);assert(bonus.smile>0);
    assert(big.lift>small.lift&&big.smile>small.smile);
    for(const outcome of['partial','loss','return'] as const)for(const p of[0,.1,.3,.6,1]){
      const b=beat('outcome',outcome),r=templeReaction(b),target=characterMotionTarget(r.clip,b,p*b.duration,5000,variant);
      assert.equal(target.smile,0);assert(target.lift<=0);assert.notEqual(r.clip,'triumph');assert.notEqual(r.clip,'success');
    }
  }
});
test('event changes preserve pose and velocity; end-of-timeline offset reset cannot restart a gesture',()=>{
  const motion=new CharacterMotion(),bonus=beat('relic'),large=beat('outcome','big');
  motion.select('bonus',templeReaction(bonus),bonus);
  for(let time=0;time<600;time+=16)motion.step(16,time,time);
  const before=motion.getState();motion.select('large',templeReaction(large),large);motion.step(0,600,0);
  assert.deepEqual(motion.getState().channels,before.channels);assert.deepEqual(motion.getState().velocity,before.velocity);
  for(let time=0;time<=1600;time+=16)motion.step(16,600+time,time);
  const held=motion.getState();motion.select('large',templeReaction(large),large);motion.step(0,2300,0);
  assert.equal(motion.getState().offsetMs,held.offsetMs);assert.deepEqual(motion.getState().channels,held.channels);
  motion.freeze();assert(Object.values(motion.getState().velocity).every(v=>v===0));
  motion.reset();assert(Object.values(motion.getState().channels).every(v=>v===0));
});
test('breathing, glance and blink remain deterministic while event variations have distinct gestures',()=>{
  const still=characterMotionTarget('breathe',undefined,0,0,0),blink=characterMotionTarget('breathe',undefined,0,3385,0),glance=characterMotionTarget('breathe',undefined,0,12350,0);
  assert(blink.blink>.9);assert(still.blink===0);assert(glance.gaze>.4);assert.notEqual(still.breath,blink.breath);
  const big=beat('outcome','big');
  const variants=[0,1,2].map(v=>characterMotionTarget('triumph',big,600,1000,v));
  assert.notDeepEqual(variants[0],variants[1]);assert.notDeepEqual(variants[1],variants[2]);
  assert.deepEqual(variants[0],characterMotionTarget('triumph',big,600,1000,0));
});
test('the spring stays bounded and finite through normal and quick transitions and recovery',()=>{
  const motion=new CharacterMotion();let clock=0;
  for(let round=0;round<30;round++)for(const b of[beat('fall'),beat('fracture'),beat('collect'),beat('relic'),beat('outcome',round%2?'partial':'big')]){
    const current={...b,duration:b.duration/(round%2?2:1)};motion.select(round+':'+b.kind,templeReaction(current),current);
    for(let offset=0;offset<=current.duration;offset+=16){
      const before=motion.getState().channels,after=motion.step(16,clock,offset);clock+=16;
      for(const channel of motionChannels){assert(Number.isFinite(after[channel]));assert(after[channel]>=-1&&after[channel]<=1);if(channel!=='blink')assert(Math.abs(after[channel]-before[channel])<.22);}
    }
  }
  motion.select('recovery',templeReaction(undefined));motion.freeze();
  for(let i=0;i<200;i++){clock+=16;motion.step(16,clock,0);}
  assert(Math.abs(motion.getState().channels.lift)<.01);assert(motion.getState().channels.smile<.01);
});
