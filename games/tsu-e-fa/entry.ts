import { TsuEFaUI } from './TsuEFaUI';
import {TsuDuelUI} from './TsuDuelUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'tsu-e-fa';
export const apiVersion = 1;
export const rulesVersion = 4;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
  const services=readGameHost();
  if (!context?.pvp) throw Error('PvP host context is required');
  return [3,4].includes(context.pvp.get()?.active?.rulesVersion??0)?new TsuDuelUI(host,context.pvp,services.gameAudio):new TsuEFaUI(host, context.pvp);
};
