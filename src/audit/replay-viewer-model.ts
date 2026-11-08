import { verifyReplayPackage, type ReplayEvent, type ReplayPackage, type ReplayState } from '../../server/audit/replay-package';
import { chessTurnReplayDefinition, verifyChessTurnReplay } from '../../server/audit/replay-pvp-turn';
import { combatReplayDefinition, reconstructCombatReplay } from '../../server/audit/replay-pvp-realtime-engine';
import { isCardTurnReplayGame, verifyCardTurnReplay } from '../../server/audit/replay-pvp-cards';
import { reconstructSportReplay, sportReplayDefinitions } from '../../server/audit/replay-pvp-sport-engine';
import { tsuTurnReplayDefinition, verifyTsuTurnReplay } from '../../server/audit/replay-pvp-tsu';

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
  const chess = game.gameId === chessTurnReplayDefinition.gameId;
  const combat = game.gameId === combatReplayDefinition.gameId;
  const reconstructed = new Map<number, ReplayState>();
  let engineVerified = false;
  if (chess || combat) {
    const canSimulate = !!manifest.initial && events.every((event, index) => event.sequence === index + 1);
    if (canSimulate || chess && !manifest.initial) {
      const result = chess
        ? verifyChessTurnReplay(pack, (sequence, state) => reconstructed.set(sequence, state))
        : reconstructCombatReplay(pack, undefined, (event, state) => reconstructed.set(event.sequence, state));
      if (result.status !== 'verified') {
        if (result.status === 'unsupported') return { status: 'unsupported' };
        return { status: canSimulate ? 'mismatch' : 'corrupt' };
      }
      engineVerified = canSimulate;
    } else {
      const pinned = verifyReplayPackage(pack, [chess ? chessTurnReplayDefinition : combatReplayDefinition]);
      if (pinned.status !== 'verified') return pinned;
    }
  } else if (game.replayProfile === 'pvp-sport' || sportReplayDefinitions.some(definition => definition.gameId === game.gameId)) {
    const result = reconstructSportReplay(pack, undefined, (event, state) => reconstructed.set(event.sequence, state));
    if (result.status !== 'verified') return result.status === 'unsupported' || result.status === 'too-large' ? { status: result.status } : { status: 'mismatch' };
    engineVerified = !!manifest.initial && !!manifest.terminal && !manifest.gaps.includes('event-gap');
  } else if (game.gameId === tsuTurnReplayDefinition.gameId) {
    const result = verifyTsuTurnReplay(pack);
    if (result.status !== 'verified') return result.status === 'unsupported' ? { status: 'unsupported' } : { status: 'mismatch' };
    engineVerified = result.engineVerified;
  } else if (isCardTurnReplayGame(game.gameId)) {
    const result = verifyCardTurnReplay(pack);
    if (result.status !== 'verified') return result.status === 'unsupported' ? { status: 'unsupported' } : { status: 'mismatch' };
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
