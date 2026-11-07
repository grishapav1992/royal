import { verifyReplayPackage, type ReplayEvent, type ReplayPackage, type ReplayState } from '../../server/audit/replay-package';
import { chessTurnReplayDefinition, verifyChessTurnReplay } from '../../server/audit/replay-pvp-turn';
import { combatReplayDefinition, reconstructCombatReplay } from '../../server/audit/replay-pvp-realtime-engine';

type Frame = { sequence: number; event: ReplayEvent | null; state: ReplayState | null; stateSequence: number | null };
type ViewerReplay = { status: 'ready'; package: ReplayPackage; frames: Frame[]; engineVerified: boolean }
  | { status: 'unsupported' | 'corrupt' | 'too-large' | 'mismatch' }
  | { status: 'incomplete'; missingFragments: number[] };

export const MAX_REPLAY_FILE_BYTES = 12 * 1024 * 1024;

export function prepareViewerReplay(input: unknown): ViewerReplay {
  const verified = verifyReplayPackage(input);
  if (verified.status !== 'verified') return verified;
  const pack = verified.value;
  const { manifest, fragments } = pack;
  const { game } = manifest;
  const events = fragments.flatMap(fragment => fragment.events);
  const chess = game.replayProfile === 'pvp-turn-based' && game.gameId === 'chess';
  const combat = game.replayProfile === 'pvp-realtime' && game.gameId === combatReplayDefinition.gameId;
  const reconstructed = new Map<number, ReplayState>();
  let engineVerified = false;
  if (chess || combat) {
    if (manifest.initial && events.every((event, index) => event.sequence === index + 1)) {
      const result = chess
        ? verifyChessTurnReplay(pack, (sequence, state) => reconstructed.set(sequence, state))
        : reconstructCombatReplay(pack, undefined, (event, state) => reconstructed.set(event.sequence, state));
      if (result.status !== 'verified') return result.status === 'unsupported' ? { status: 'unsupported' } : { status: 'mismatch' };
      engineVerified = true;
    } else {
      const pinned = verifyReplayPackage(pack, [chess ? chessTurnReplayDefinition : combatReplayDefinition]);
      if (pinned.status !== 'verified') return pinned;
    }
  }
  let state = manifest.initial, stateSequence: number | null = state ? 0 : null, previous = 0;
  const frames: Frame[] = [{ sequence: 0, event: null, state, stateSequence }];
  for (const event of events) {
    if (event.sequence !== previous + 1) { state = null; stateSequence = null; }
    const exact = reconstructed.get(event.sequence) ??
      (event.data.kind === 'checkpoint' || event.data.kind === 'terminal' ? event.data.state : null);
    if (exact) { state = exact; stateSequence = event.sequence; }
    frames.push({ sequence: event.sequence, event, state, stateSequence });
    previous = event.sequence;
  }
  return { status: 'ready', package: pack, frames, engineVerified };
}
