import {readGameHost,type GameModuleV1} from '../../src/modules/GameHostContract';
import {TempleUI} from './TempleUI';
import {CascadeUI} from './CascadeUI';
import {cascadeStyles} from './cascadeStyles';
import {cascadeFeedbackStyles} from './cascadeFeedbackStyles';
import {styles} from './styles';
import {feedbackStyles} from './feedbackStyles';
import {referenceStyles} from './referenceStyles';
import {characterStyles} from './characterStyles';
import {playbackStyles} from './playbackStyles';
import {navigationStyles} from './navigationStyles';
import './shell.css';
export const gameId='studio-flooded-temple';
export const apiVersion=1;
export const rulesVersion=2;
export const progressVersion=2;
export const mount:GameModuleV1['mount']=(host,context)=>{
  const services=readGameHost(),title=services.i18n.language==='en'?'Flooded Temple':'Затопленный храм';
  context?.setTitle?.(title);
  const frame=host.ownerDocument.createElement('iframe');frame.title=title;frame.className='temple-frame';
  const stage=host.closest<HTMLElement>('.mini-stage')??host;
  let disposed=false,paused=false,game:TempleUI|CascadeUI|undefined,app:HTMLElement|undefined,legacy=false,owner:string|null=null,timer=0;
  const sync=()=>{
    if(disposed||!app)return;
    const client=services.expansionClient,p=client.pending,s=client.sessions.find(s=>s.gameId===gameId);
    const wantsLegacy=!!(s?.state==='active'&&s.rulesVersion===1)||!!(p?.gameId===gameId&&(p.action==='start'?!!p.settings&&'temple'in p.settings&&p.settings.temple.mode!=='cascades':p.move!=='temple-cascade'));
    const accountChanged=owner!==client.accountId;
    clearTimeout(timer);timer=0;
    if(game&&wantsLegacy===legacy&&!accountChanged)return;
    if(game&&legacy&&!accountChanged&&game.getState().busy){timer=window.setTimeout(sync,100);return;}
    game?.destroy();owner=client.accountId;legacy=wantsLegacy;
    game=legacy?new TempleUI(app,services):new CascadeUI(app,services);
    if(legacy){const note=app.ownerDocument.createElement('p');note.className='ft-legacy-note';note.textContent=services.i18n.language==='en'?'Finish your saved expedition under its original rules. New rounds use cascades.':'Заверши сохранённую экспедицию по прежним правилам. Новые раунды используют каскады.';app.prepend(note);}
    if(paused)game.pause();
  };
  const changed=()=>queueMicrotask(sync);
  services.expansionClient.addEventListener('change',changed);services.demoWallet.addEventListener('change',changed);
  const fit=()=>{if(!disposed)frame.style.height=Math.max(180,stage.clientHeight)+'px';};
  const observer=new ResizeObserver(fit);observer.observe(stage);fit();
  frame.addEventListener('load',()=>{
    if(disposed||!frame.contentDocument)return;
    game?.destroy();
    const doc=frame.contentDocument;doc.documentElement.lang=services.i18n.language;doc.title=title;
    const style=doc.createElement('style');style.textContent=styles+feedbackStyles+referenceStyles+characterStyles+playbackStyles+navigationStyles+cascadeStyles+cascadeFeedbackStyles;doc.head.replaceChildren(style);
    app=doc.createElement('main');doc.body.replaceChildren(app);game=undefined;sync();
  });
  frame.src='about:blank';host.replaceChildren(frame);
  return {getState:()=>game?.getState()??{gameId,loading:true},pause(){paused=true;game?.pause();},resume(){paused=false;game?.resume();},destroy(){disposed=true;clearTimeout(timer);services.expansionClient.removeEventListener('change',changed);services.demoWallet.removeEventListener('change',changed);observer.disconnect();game?.destroy();frame.remove();}};
};
