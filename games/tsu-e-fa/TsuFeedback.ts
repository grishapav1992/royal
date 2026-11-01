import type { PvpChallenge } from '../../src/shared/pvp';
import type { TsuEFaView } from '../../src/shared/tsuEFa';
import { TSU_DUEL_BEAT_MS } from '../../src/shared/tsuDuel';
import type { TsuCue } from './TsuSounds';

type Output = { available(): boolean; lead(): number; play(cue: TsuCue, at?: number, variant?: number): number | undefined; cancel(): void };
export class TsuFeedback {
  private match = '';
  private previous?: { status: string; locked: boolean; ready: boolean; score: [number, number]; last: number; round: number };
  private beat = -1;
  private beatRound = 0;
  private blocked = false;
  private revealAt = 0;
  private oldScore: [number, number] = [0, 0];
  constructor(private output: Output) {}
  update(c: PvpChallenge, s: TsuEFaView, serverNow: number, now: number, active = true) {
    const ownId = s.self === 0 ? c.creatorId : c.opponentId, ready = c.ready.includes(ownId!), round = s.round;
    const next = { status: c.status, locked: s.locked[s.self], ready, score: [...s.score] as [number, number], last: s.last?.round ?? 0, round };
    const elapsedBeat = s.duel?.stage === 'countdown' ? Math.min(4, Math.floor((serverNow - s.duel.startsAt) / TSU_DUEL_BEAT_MS)) : -1;
    if (this.match !== c.id || !this.previous) {
      this.output.cancel(); this.match = c.id; this.previous = next; this.beat = elapsedBeat; this.beatRound = round; this.revealAt = 0;
      return false; // Loading or reopening an old result is quiet.
    }
    const previous = this.previous;
    if (s.duel?.stage === 'countdown' && this.beatRound !== round) { this.beat = -1; this.beatRound = round; }
    const blocked = !active || !!c.disconnected.length || !!s.duel?.paused || !this.output.available();
    if (blocked) {
      if (!this.blocked) this.output.cancel();
      this.beat = elapsedBeat; this.revealAt = 0;
    } else {
      if (c.status === 'arriving' && ready && !previous.ready || c.status === 'playing' && next.locked && (!previous.locked || previous.round !== round)) this.output.play('lock', now);
      if (c.status === 'playing' && previous.status === 'arriving') this.output.play('ready', now);
      if (s.last && next.last > previous.last && s.duel?.stage === 'reveal') {
        this.output.cancel(); this.oldScore = previous.score;
        this.revealAt = this.output.play('reveal', now) ?? now;
        const cue = c.status === 'finished' ? c.winnerId === ownId ? 'match-win' : 'match-lose' : s.last.winner === null ? 'draw' : s.last.winner === s.self ? 'round-win' : 'round-lose';
        this.output.play(cue, this.revealAt + 100);
      } else if (c.status === 'finished' && previous.status === 'playing') this.output.play(c.winnerId === null ? 'draw' : c.winnerId === ownId ? 'match-win' : 'match-lose', now);
      if (c.status === 'playing' && s.duel?.stage === 'countdown') {
        const horizon = Math.max(120, this.output.lead() + 60);
        for (let i = this.beat + 1; i < 5; i++) {
          const until = s.duel.startsAt + i * TSU_DUEL_BEAT_MS - serverNow;
          if (until > horizon) break;
          this.beat = i;
          if (until >= -120) this.output.play('beat', now + until, i);
        }
      }
    }
    this.blocked = blocked; this.previous = next;
    return now < this.revealAt;
  }
  score(current: [number, number], now: number) { return now < this.revealAt ? this.oldScore : current; }
}
