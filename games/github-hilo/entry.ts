import { CasinoSessionsUI } from '../../src/ui/CasinoSessionsUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'github-hilo';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new CasinoSessionsUI(host, gameId);
};
