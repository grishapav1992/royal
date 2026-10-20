import { AfterglowUI } from '../../src/ui/AfterglowUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'studio-afterglow';
export const apiVersion = 1;
export const rulesVersion = 2;
export const progressVersion = 3;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new AfterglowUI(host);
};
