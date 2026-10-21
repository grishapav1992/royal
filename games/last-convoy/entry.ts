import { LastConvoyUI } from '../../src/ui/LastConvoyUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import '../../src/ui/studio-games.css';
export const gameId = 'studio-last-convoy';
export const apiVersion = 1;
export const rulesVersion = 2;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new LastConvoyUI(host);
};
