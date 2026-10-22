import { mountImportedMotion } from '../../src/ui/importedMotion/ImportedMotion';
import { CasinoSessionsUI } from '../../src/ui/CasinoSessionsUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'github-tower';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return mountImportedMotion(host, gameId, content => new CasinoSessionsUI(content, gameId));
};
