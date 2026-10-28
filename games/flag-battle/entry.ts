import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { FlagBattleUI } from './FlagBattleUI';
import './style.css';
export const gameId = 'flag-battle';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
  readGameHost();
  return new FlagBattleUI(host);
};
