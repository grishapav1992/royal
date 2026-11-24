import { LastExitUI } from './LastExitUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import '../../src/ui/active-game-viewport.css';

export const gameId = 'github-crash';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new LastExitUI(host);
};
