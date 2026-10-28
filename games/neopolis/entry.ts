import type { GameModuleV1 } from '../../src/modules/GameHostContract';
import { NeopolisUI } from './NeopolisUI';
import './neopolis.css';
import './neopolis-layout.css';
export const gameId = 'studio-neopolis';
export const apiVersion = 1;
export const rulesVersion = 4;
export const progressVersion = 4;
export const mount: GameModuleV1['mount'] = (host, context) => {
  const game = new NeopolisUI(host);
  context?.setTitle?.(game.title);
  return game;
};
