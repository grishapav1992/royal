import type { GameModuleV1 } from '../../src/modules/GameHostContract';
import { NEOPOLIS_RULES_VERSION } from '../../src/shared/neopolisMath';
import { NeopolisUI } from './NeopolisUI';
import './neopolis.css';
export const gameId = 'studio-neopolis';
export const apiVersion = 1;
export const rulesVersion = NEOPOLIS_RULES_VERSION;
export const progressVersion = 4;
export const mount: GameModuleV1['mount'] = (host, context) => {
  const game = new NeopolisUI(host);
  context?.setTitle?.(game.title);
  return game;
};
