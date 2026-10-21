import { DemoSlot } from '../../src/ui/DemoSlot';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'luelon';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
 readGameHost();
 return new DemoSlot(host, context?.setTitle ?? (() => {}));
};
