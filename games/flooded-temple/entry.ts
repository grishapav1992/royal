import {readGameHost,type GameModuleV1} from '../../src/modules/GameHostContract';
import './shell.css';
export const gameId='studio-flooded-temple';
export const apiVersion=1;
export const rulesVersion=1;
export const progressVersion=1;
// Stage 2 packaging contract only. Not in the playable catalogue until stage 3.
// There is deliberately no start command or wallet operation in this scaffold.
export const mount:GameModuleV1['mount']=host=>{
  const panel=host.ownerDocument.createElement('p');
  panel.className='temple-preparing';
  panel.textContent=readGameHost().i18n.language==='en'?'Flooded Temple. Preparing the expedition.':'Затопленный храм. Подготовка экспедиции.';
  panel.setAttribute('role','status');host.replaceChildren(panel);
  return {getState:()=>({gameId,stage:'server-qualified',playable:false}),destroy:()=>panel.remove()};
};
