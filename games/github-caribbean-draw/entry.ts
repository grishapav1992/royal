import { CasinoExpansionView } from '../../src/ui/CasinoExpansionView';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'github-caribbean-draw';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new CasinoExpansionView(host, gameId);
};
