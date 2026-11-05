import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { BattleshipView } from './view';

export const gameId = 'battleship';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
  readGameHost();
  if (!context?.pvp) throw Error('PvP host context is required');
  return new BattleshipView(host, context.pvp);
};
