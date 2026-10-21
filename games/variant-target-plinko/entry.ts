import { TargetPlinkoUI } from '../../src/ui/TargetPlinkoUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'variant-target-plinko';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 1;
export const mount: GameModuleV1['mount'] = host => {
 readGameHost();
 return new TargetPlinkoUI(host, gameId);
};
