import type { GameModuleV1 } from '../../src/modules/GameHostContract';
import { NeopolisUI } from './NeopolisUI';
import './neopolis.css';
export const gameId = 'studio-neopolis';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
  const game = new NeopolisUI(host);
  context?.setTitle?.(game.title);
  return game;
};
