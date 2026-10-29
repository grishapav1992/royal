import { JackieUI } from './JackieUI';
import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
export const gameId = 'original-jackie-chan';
export const apiVersion = 1;
export const rulesVersion = 1;
export const progressVersion = 2;
export const mount: GameModuleV1['mount'] = host => { readGameHost(); return new JackieUI(host); };
