import { mountImportedMotion } from '../../src/ui/importedMotion/ImportedMotion';
import { LimboSlotUI } from '../../src/ui/LimboSlotUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'royal-limbo';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return mountImportedMotion(host, gameId, content => new LimboSlotUI(content, gameId), { background: '/assets/github-worlds/royal-limbo/background-v1.webp', character: '/assets/github-worlds/royal-limbo/character-v1.webp' });
};
