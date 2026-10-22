import { mountImportedMotion } from '../../src/ui/importedMotion/ImportedMotion';
import { CasinoExpansionView } from '../../src/ui/CasinoExpansionView';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'github-diamonds';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return mountImportedMotion(host, gameId, content => new CasinoExpansionView(content, gameId), { background: '/assets/github-worlds/github-diamonds/background-v1.webp', character: '/assets/github-worlds/github-diamonds/character-v1.webp' });
};
