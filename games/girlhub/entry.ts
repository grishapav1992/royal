import { AfterglowUI } from '../../src/ui/AfterglowUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import '../../src/ui/studio-games.css';
export const gameId = 'studio-afterglow';
export const apiVersion = 1;
export const rulesVersion = 2;
export const progressVersion = 4;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new AfterglowUI(host);
};
