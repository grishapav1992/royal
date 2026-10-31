import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { FlagToteUI } from './FlagToteUI';
import './style.css';
export const gameId = 'flag-tote';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
  if (!readGameHost().flagToteClient) throw Error('Обнови страницу для общего тотализатора.');
  return new FlagToteUI(host);
};
