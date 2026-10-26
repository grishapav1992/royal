import type { CombatState, Fighter } from './combat';

export type CombatFighterView = Pick<Fighter, 'x' | 'y' | 'health' | 'action' | 'inputSequence'>;
export type CombatView = Omit<CombatState, 'fighters'> & { fighters: CombatFighterView[] };

/** Only visible fight state crosses the transport. Input acknowledgements belong to their sender. */
export function combatView(state: CombatState, viewer?: string): CombatView {
  return {
    id: state.id, players: [...state.players], names: [...state.names], ready: [...state.ready], stake: state.stake,
    phase: state.phase,
    fighters: state.fighters.map((fighter, index) => ({
      x: fighter.x, y: fighter.y, health: fighter.health, action: fighter.action,
      inputSequence: viewer === state.players[index] ? fighter.inputSequence : 0,
    })),
    remaining: state.remaining, countdown: state.countdown, winner: state.winner, winnerName: state.winnerName,
    message: state.message, pot: state.pot, fee: state.fee, payout: state.payout,
    revision: state.revision, hitSeq: state.hitSeq,
  };
}
