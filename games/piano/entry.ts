import { ActivityGameView } from '../../src/ui/ActivityGameView';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'piano';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
 readGameHost();
 if (!context?.activity) throw Error('Activity host context is required');
 return new ActivityGameView(host, gameId, context.activity);
};
