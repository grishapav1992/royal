import type { FlagCountry } from '../../src/shared/flagBattle';
import type { RollPlan } from './FlagRollPhysics';

export type FlagBattleCue = 'select' | 'start' | 'collision' | 'wall' | 'eliminate' | 'pulse' | 'final-two' | 'heartbeat' | 'reveal' | 'win' | 'lose';
export interface FlagBattleSoundEvent { cue: FlagBattleCue; at: number; strength: number; pan: number; variant: number }
export const FLAG_CELEBRATION_SECONDS = .7;

/**
 * One audio score per confirmed round, on the same playhead as the arena. Impacts are thinned so
 * repeated knocks stay distinct; the tension pulse speeds up as the field shrinks and hands over to a
 * heartbeat for the final two.
 */
export function flagBattleTimeline(plan: RollPlan, labels: FlagCountry[], selected: FlagCountry, won: boolean, seconds: number): FlagBattleSoundEvent[] {
  const scale = seconds / plan.duration, total = plan.order.length;
  const exits: FlagBattleSoundEvent[] = plan.exits.map((e, i) => ({ cue: 'eliminate', at: e.time * scale,
    strength: labels[e.id] === selected ? 1 : .7, pan: Math.max(-.8, Math.min(.8, e.x * .7)), variant: labels[e.id] === selected ? -1 : i % 6 }));
  const finalTwoAt = exits[exits.length - 2].at + .11, lastExit = exits[exits.length - 1].at;
  const near = (at: number, gap: number) => exits.some(exit => Math.abs(exit.at - at) < gap);
  const buckets = new Map<number, RollPlan['contacts'][number]>();
  for (const e of plan.contacts) {
    const at = e.time * scale;
    if (e.strength < .3 || at < .3 || Math.abs(finalTwoAt - at) < .15 || near(at, .1)) continue;
    const bucket = Math.floor(at / .14), prior = buckets.get(bucket);
    if (!prior || prior.strength < e.strength) buckets.set(bucket, e);
  }
  const spaced: RollPlan['contacts'] = [];
  for (const e of [...buckets.values()].sort((a, b) => b.strength - a.strength)) {
    if (spaced.every(prior => Math.abs(prior.time - e.time) * scale >= .12)) spaced.push(e);
  }
  const impacts: FlagBattleSoundEvent[] = spaced.map(e => ({ cue: e.kind, at: e.time * scale,
    strength: Math.min(1, .25 + e.strength * .42), pan: Math.max(-.75, Math.min(.75, e.x * .75)), variant: Math.floor(e.time * scale / .14) % 5 }));
  const pulses: FlagBattleSoundEvent[] = [];
  for (let at = .9; at < finalTwoAt - .3;) {
    const out = exits.filter(e => e.at <= at).length, progress = out / Math.max(1, total - 2);
    if (!near(at, .12)) pulses.push({ cue: 'pulse', at, strength: .55 + progress * .45, pan: 0, variant: Math.min(4, Math.floor(progress * 5)) });
    at += .95 - progress * .5;
  }
  const beats: FlagBattleSoundEvent[] = [];
  for (let at = finalTwoAt + .55, i = 0; at < lastExit - .25; at += Math.max(.5, .78 - i * .03), i++) {
    if (!near(at, .12)) beats.push({ cue: 'heartbeat', at, strength: Math.min(1, .7 + i * .05), pan: 0, variant: 0 });
  }
  const events: FlagBattleSoundEvent[] = [{ cue: 'start', at: .04, strength: 1, pan: 0, variant: 0 }, ...impacts, ...exits, ...pulses, ...beats,
    { cue: 'final-two', at: finalTwoAt, strength: 1, pan: 0, variant: 0 },
    { cue: 'reveal', at: seconds + .08, strength: 1, pan: 0, variant: 0 },
    { cue: won ? 'win' : 'lose', at: seconds + FLAG_CELEBRATION_SECONDS, strength: 1, pan: 0, variant: 0 },
  ];
  return events.sort((a, b) => a.at - b.at);
}
