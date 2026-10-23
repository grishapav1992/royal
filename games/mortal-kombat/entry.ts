import { readGameHost, type GameModuleV1 } from '../../src/modules/GameHostContract';
import { CombatUI } from './CombatUI';
export const gameId='mortal-kombat',apiVersion=1,rulesVersion=1,progressVersion=1;
export const mount:GameModuleV1['mount']=(host,context)=>{
 readGameHost();
 if(!context?.activity)throw Error('Activity host context is required');
 return new CombatUI(host,context.activity);
};
