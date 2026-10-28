import { randomInt } from 'node:crypto';
import { advanceNeopolis, emptyNeopolisView, initialTeam, validNeopolisSettings, validNeopolisStake, validNeopolisSettlement, type NeopolisSettings, type NeopolisView } from '../../src/shared/neopolis';

export class NeopolisMoveError extends Error {}
export function startNeopolis(settings: NeopolisSettings, stake: string, previous?: { stakeUnits: string; view: NeopolisView }, draw: (max: number) => number = randomInt) {
  if (!validNeopolisSettings(settings) || !validNeopolisStake(stake)) throw new NeopolisMoveError('Neopolis: invalid settings');
  if (previous && !validNeopolisSettlement('settled', previous.stakeUnits, previous.stakeUnits, previous.view.totalPayoutUnits, previous.view)) throw Error('Invalid saved Neopolis progress');
  const continuing = previous && !previous.view.team.complete;
  if (continuing && previous.view.team.starter !== settings.neopolis.hero) throw new NeopolisMoveError('Neopolis: finish the current team cycle before changing the starter');
  const team = continuing ? previous.view.team : initialTeam(settings.neopolis.hero);
  return advanceNeopolis(emptyNeopolisView(team), stake, draw);
}
export function moveNeopolis(view: NeopolisView, stake: string, revision: unknown, draw: (max: number) => number = randomInt) {
  if (revision !== view?.revision || !validNeopolisSettlement('active', stake, stake, '0', view)) throw new NeopolisMoveError('Neopolis: stale bonus move');
  return advanceNeopolis(view, stake, draw);
}
