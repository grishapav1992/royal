import test from 'node:test';
import assert from 'node:assert/strict';
import {fightSound,type FightSound} from '../games/jackie-chan/JackieFightSounds';

test('arcade impacts retain headroom, a fast onset and a quiet tail at browser sample rates',()=>{
  for(const rate of [44100,48000])for(const cue of ['punch','kick','chair','block','whoosh','wood','landing']as FightSound[])for(let variant=0;variant<4;variant++){
    const data=fightSound(cue,rate,variant);let peak=0,energy=0,tail=0,attack=0;
    for(let i=0;i<data.length;i++){assert(Number.isFinite(data[i]));peak=Math.max(peak,Math.abs(data[i]));energy+=data[i]**2;if(i<rate*.025)attack=Math.max(attack,Math.abs(data[i]));if(i>data.length-rate*.004)tail=Math.max(tail,Math.abs(data[i]));}
    assert(peak<.76);assert(energy/data.length>1e-6);assert(tail<.015);
    if(['punch','kick','chair'].includes(cue))assert(attack>.35);
  }
});

test('strike materials and repeated variations are distinct and reproducible without a game random source',()=>{
  const hits=['punch','kick','chair']as const;
  for(const cue of hits){assert.deepEqual(fightSound(cue,48000,2),fightSound(cue,48000,2));assert.notDeepEqual(fightSound(cue,48000,0),fightSound(cue,48000,1));}
  for(const cue of hits.slice(1))assert.notDeepEqual(fightSound('punch',48000),fightSound(cue,48000));
});
