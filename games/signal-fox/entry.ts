import { DiceSlotUI } from '../../src/ui/DiceSlotUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import '../../src/ui/studio-games.css';
export const gameId = 'studio-signal-fox';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new DiceSlotUI(host, gameId);
};
