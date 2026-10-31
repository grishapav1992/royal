import type { GameModuleV1 } from '../../src/modules/GameHostContract';
import { CaribbeanUI } from './CaribbeanUI';
import './caribbean.css';
export const gameId = 'studio-caribbean-treasures';
export const apiVersion = 1;
export const rulesVersion = 2;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
  const game = new CaribbeanUI(host);
  context?.setTitle?.(game.title);
  return game;
};
