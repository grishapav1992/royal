import type { FlagCountry } from '../../src/shared/flagBattle';
import type { FlagPhysicsPlan } from './FlagPhysics';
export type FlagCue = 'select' | 'start' | 'collision' | 'wall' | 'eliminate' | 'final-two' | 'win' | 'lose';
export interface FlagSoundEvent { cue: FlagCue; at: number; strength: number; pan: number; variant: number }
export function flagSoundTimeline(plan: FlagPhysicsPlan, labels: FlagCountry[], selected: FlagCountry, won: boolean, seconds: number): FlagSoundEvent[] {
  const scale = seconds / plan.duration;
  const exits: FlagSoundEvent[] = plan.exits.map((e, i) => ({ cue: 'eliminate', at: e.time * scale,
    strength: labels[e.id] === selected ? 1 : .65, pan: Math.max(-.8, Math.min(.8, e.x * .7)), variant: labels[e.id] === selected ? -1 : i }));
  const finalTwoAt = exits[9].at + .11;
  const buckets = new Map<number, typeof plan.contacts[number]>();
  for (const e of plan.contacts) {
    const at = e.time * scale;
    if (e.strength < .32 || at < .30 || Math.abs(finalTwoAt - at) < .15 || exits.some(exit => Math.abs(exit.at - at) < .12)) continue;
    const bucket = Math.floor(at / .18), prior = buckets.get(bucket);
    if (!prior || prior.strength < e.strength) buckets.set(bucket, e);
  }
  const spaced: typeof plan.contacts = [];
  for (const e of [...buckets.values()].sort((a, b) => b.strength - a.strength)) {
    if (spaced.every(prior => Math.abs(prior.time - e.time) * scale >= .16)) spaced.push(e);
  }
  const impacts: FlagSoundEvent[] = spaced.map(e => ({ cue: e.kind, at: e.time * scale,
    strength: Math.min(1, .2 + e.strength * .4), pan: Math.max(-.7, Math.min(.7, e.x * .7)), variant: Math.floor(e.time * scale / .18) % 5 }));
  const events: FlagSoundEvent[] = [{ cue: 'start', at: .04, strength: 1, pan: 0, variant: 0 }, ...impacts, ...exits,
    { cue: 'final-two', at: finalTwoAt, strength: 1, pan: 0, variant: 0 },
    { cue: won ? 'win' : 'lose', at: seconds + .7, strength: 1, pan: 0, variant: 0 },
  ];
  return events.sort((a, b) => a.at - b.at);
}
