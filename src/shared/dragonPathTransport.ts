import type { ExpansionAction, ExpansionSession, ExpansionView } from './casinoExpansion';
import { studioSamePayload } from './studioGames';
import {
  DRAGON_PATH_CHOOSE_REWARD, DRAGON_PATH_FREE_SPIN, DRAGON_PATH_GAME, DRAGON_PATH_RULES_VERSION,
} from './dragonPathProtocol';
import { readDragonPath, type DragonPathResult } from './dragonPathRound';

export function dragonPathExpansionView(result: DragonPathResult): ExpansionView {
  const { round, actions, ended } = result;
  const { wins, scatterPositions } = result.free ?? result.base;
  return {
    player: [], dealer: [], community: [],
    phase: round.revision, ended, message: '',
    dragonPath: { round, wins, scatterPositions },
    actions: actions.map(action => action.move === DRAGON_PATH_FREE_SPIN
      ? { move: action.move, label: 'Бесплатный спин', cost: 0 }
      : { move: action.move, label: 'Подтвердить выбор', cost: 0, minPicks: 1, maxPicks: 1 }),
  };
}

export function validDragonPathBaseSession(session: ExpansionSession): boolean {
  if (session.gameId !== DRAGON_PATH_GAME || session.rulesVersion !== DRAGON_PATH_RULES_VERSION ||
      typeof session.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(session.id) ||
      Object.keys(session).sort().join(',') !== 'gameId,id,returnedUnits,rulesVersion,spentUnits,stakeUnits,state,view') return false;
  try {
    const result = readDragonPath(session.view.dragonPath?.round);
    return session.stakeUnits === result.round.stakeUnits && session.spentUnits === session.stakeUnits &&
      session.state === (result.ended ? 'settled' : 'active') && session.returnedUnits === result.baseCreditUnits &&
      studioSamePayload(session.view, dragonPathExpansionView(result));
  } catch {
    return false;
  }
}

export function validDragonPathReply(session: ExpansionSession, op: ExpansionAction, replayed: boolean, sessions: ExpansionSession[]): boolean {
  if (op.gameId !== DRAGON_PATH_GAME) return true;
  const round = session.view.dragonPath?.round;
  const latest = sessions.find(s => s.gameId === DRAGON_PATH_GAME);
  if (!round || !latest || (latest.id === session.id ? !studioSamePayload(latest, session) : !replayed)) return false;
  if (op.action === 'start') return session.stakeUnits === op.stakeUnits && (replayed || round.revision === 1);
  if (op.move === DRAGON_PATH_FREE_SPIN) return round.free !== null && (replayed || round.revision === 2);
  return op.move === DRAGON_PATH_CHOOSE_REWARD && round.revision === 3 && round.reward === op.picks?.[0];
}
