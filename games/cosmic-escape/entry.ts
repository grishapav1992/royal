import { CosmicEscapeUI } from '../../src/ui/CosmicEscapeUI';
import { mountGameHostRefresh, readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import '../../src/ui/studio-games.css';
import { StudioSlotUI } from '../../src/ui/StudioSlotUI';
import { LuelonGameRouter } from '../../src/ui/LuelonGameRouter';
export const gameId = 'studio-cosmic-escape';
export const apiVersion = 1;
export const rulesVersion = 2;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 const runtime = readGameHost();
 if (runtime.cosmicStakeLimit !== 1) return mountGameHostRefresh(host, 'Cosmic Escape', runtime.i18n.language);
 return new LuelonGameRouter(host, gameId, body => new StudioSlotUI(body, gameId), body => new CosmicEscapeUI(body));
};

import '../../src/ui/active-game-viewport.css';
