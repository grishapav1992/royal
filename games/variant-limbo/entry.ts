import { LimboSlotUI } from '../../src/ui/LimboSlotUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'variant-limbo';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new LimboSlotUI(host, gameId);
};
