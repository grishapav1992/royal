import { VolcanicPlinkoUI } from '../../src/ui/VolcanicPlinkoUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'royal-plinko';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new VolcanicPlinkoUI(host);
};
