import { CardDuelView } from '../../src/ui/CardDuelView';
import {readGameHost,type GameModuleV1} from '../../src/modules/GameHostContract';
export const gameId='crazy-eights';
export const apiVersion=1;
export const rulesVersion=1;
export const progressVersion=1;
export const mount:GameModuleV1['mount']=(host,context)=>{readGameHost();if(!context?.pvp)throw Error('PvP host context is required');return new CardDuelView(host,gameId,context.pvp);};
