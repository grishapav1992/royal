import { ActivityGameView } from '../../src/ui/ActivityGameView';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { ChessBoard } from '../../src/ui/ChessBoard';
export const gameId = 'chess';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = (host, context) => {
 readGameHost();
 if (!context?.activity) throw Error('Activity host context is required');
 return new ActivityGameView(host, gameId, context.activity, { chess: send => new ChessBoard(send) });
};
