import { mountImportedMotion } from '../../src/ui/importedMotion/ImportedMotion';
import { OriginalGameView } from '../../src/ui/OriginalGameView';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'royal-mines';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return mountImportedMotion(host, gameId, content => new OriginalGameView(content, gameId), { background: '/assets/github-worlds/royal-mines/background-v1.webp', character: '/assets/github-worlds/royal-mines/character-v1.webp' });
};
