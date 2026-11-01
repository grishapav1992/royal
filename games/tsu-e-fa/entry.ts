import { TsuEFaUI } from './TsuEFaUI';
import {TsuDuelUI} from './TsuDuelUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'tsu-e-fa';
export const apiVersion = 1;
export const rulesVersion = 3;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
  readGameHost();
  if (!context?.pvp) throw Error('PvP host context is required');
  return context.pvp.get()?.active?.rulesVersion===3?new TsuDuelUI(host,context.pvp):new TsuEFaUI(host, context.pvp);
};
