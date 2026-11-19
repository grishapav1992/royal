import { CaramelCarnivalUI } from '../../src/ui/CaramelCarnivalUI';
import { mountGameHostRefresh, readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import '../../src/ui/studio-games.css';
import { CascadeSlotUI } from '../../src/ui/CascadeSlotUI';
import { LuelonGameRouter } from '../../src/ui/LuelonGameRouter';
export const gameId = 'studio-caramel-carnival';
export const apiVersion = 1;
export const rulesVersion = 2;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 const runtime = readGameHost();
 if (runtime.caramelStakeLimit !== 1) return mountGameHostRefresh(host, 'Caramel Carnival', runtime.i18n.language);
 return new LuelonGameRouter(host, gameId, body => new CascadeSlotUI(body, gameId), body => new CaramelCarnivalUI(body));
};

import '../../src/ui/active-game-viewport.css';
