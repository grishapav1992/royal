import { CascadeSlotUI } from '../../src/ui/CascadeSlotUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import '../../src/ui/studio-games.css';
export const gameId = 'studio-starfall-oracle';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new CascadeSlotUI(host, gameId);
};
