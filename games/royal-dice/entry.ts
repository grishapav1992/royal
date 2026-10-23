import { mountImportedMotion } from '../../src/ui/importedMotion/ImportedMotion';
import { DiceSlotUI } from '../../src/ui/DiceSlotUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'royal-dice';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return mountImportedMotion(host, gameId, content => new DiceSlotUI(content, gameId), { background: '/assets/github-worlds/royal-dice/background-v1.webp', character: '/assets/github-worlds/royal-dice/character-v1.webp' });
};
