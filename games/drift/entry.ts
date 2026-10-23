import { createArcade } from '../../src/game/arcades';
import '../../src/modules/arcade-module.css';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'drift';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
 readGameHost();
 const game = createArcade(host, 'drift', context?.onStatus ?? (() => {}));
 host.classList.add('royal-arcade-module');
 return { start: game.start, restart: game.restart, getState: game.getState, pause: () => game.game.scene.pause(gameId), resume: () => game.game.scene.resume(gameId), destroy: () => { game.game.destroy(true); host.classList.remove('royal-arcade-module'); } };
};
