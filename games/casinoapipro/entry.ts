import { CasinoApiProUI } from '../../src/ui/CasinoApiProUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'casinoapipro';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
 readGameHost();
 if (!context?.scene) throw Error('Provider game requires room services');
 const game = new CasinoApiProUI(context.scene, context.onPlaying, context.onClosed, false,
   context.provider?.embedded ? {host, ...context.provider, setTitle:context.setTitle} : undefined);
 game.open(true);
 return game;
};
