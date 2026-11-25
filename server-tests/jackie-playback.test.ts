import test from 'node:test';
import assert from 'node:assert/strict';
import {JackiePlayback} from '../games/jackie-chan/JackiePlayback';

test('switching speed preserves the current frame and never restarts an accepted fight',()=>{
  const clock=new JackiePlayback();clock.start(1000);
  assert.equal(clock.elapsed(2250),1.25);clock.setSpeed(2,2250);assert.equal(clock.elapsed(2250),1.25);
  assert.equal(clock.elapsed(3000),2.75);clock.setSpeed(1,3000);assert.equal(clock.elapsed(3500),3.25);
  clock.settle();assert.equal(clock.elapsed(4000),Infinity);clock.setSpeed(2,4500);assert.equal(clock.elapsed(5000),Infinity);
  clock.start(6000);assert.equal(clock.elapsed(5900),0);assert.equal(clock.elapsed(6500),1);
});
test('fast mode halves the display time of the same script',()=>{
  for(const speed of [1,2]as const){const clock=new JackiePlayback();clock.setSpeed(speed,0);clock.start(100);assert.equal(clock.elapsed(100+4000/speed),4);}
});
