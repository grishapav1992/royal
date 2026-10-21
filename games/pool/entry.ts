import { ActivityGameView } from '../../src/ui/ActivityGameView';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { TableRenderer } from '../../src/ui/TableRenderer';
export const gameId = 'pool';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
 readGameHost();
 if (!context?.activity) throw Error('Activity host context is required');
 return new ActivityGameView(host, gameId, context.activity, { table: canvas => new TableRenderer(canvas) });
};
