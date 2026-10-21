import { t as translateText } from '../i18n/index';
import {CARAMEL_GAME,validCaramelSettings} from '../shared/caramelCarnival';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { isLuelonSlotGame, validLuelonSlotSettings } from '../shared/luelonSlots';
import type { ExpansionGameId } from '../shared/casinoExpansion';

/** Finish an already saved legacy round before opening the revised game. */
export class LuelonGameRouter {
  private child?: {destroy():void};
  private owner = client.accountId;
  private destroyed = false;
  private legacy = false;
  private loading = false;
  private status?: HTMLElement;
  private upgrade?: HTMLButtonElement;
  private change = () => {
    if(this.destroyed)return;
    if(this.owner!==client.accountId){
      this.owner=client.accountId;this.child?.destroy();this.child=undefined;
      void this.load();return;
    }
    if(!this.child){this.mountIfReady();return;}
    if(this.legacy){
      const session=client.sessions.find(s=>s.gameId===this.game);
      if(session?.rulesVersion===2){this.mount(false);return;}
      if(this.upgrade)this.upgrade.disabled=!!client.pending||client.busy||session?.state==='active';
      if(this.status)this.status.textContent=session?.state==='active'||client.pending
        ?translateText('Заверши сохранённый раунд по прежним правилам. Затем откроется новая версия с полными правилами.')
        :translateText('Прежний раунд завершён. Можно открыть новую версию с полными правилами.');
    }
  };
  constructor(private host:HTMLElement,private game:ExpansionGameId,private old:(host:HTMLElement)=>{destroy():void},private current:(host:HTMLElement)=>{destroy():void}){client.addEventListener('change',this.change);void this.load();}
  private async load(){
    if(this.destroyed||this.loading)return;
    if(!client.accountId){this.mount(false);return;}
    this.loading=true;
    this.host.replaceChildren();const message=document.createElement('p');message.setAttribute('role','status');message.textContent=translateText('Проверяем сохранённый раунд…');this.host.append(message);
    await client.refresh();this.loading=false;
    if(this.destroyed)return;
    this.mountIfReady();
    if(!this.child&&!client.loading){
      message.textContent=client.error||translateText('Не удалось проверить сохранённый раунд.');
      const retry=document.createElement('button');retry.type='button';retry.textContent=translateText('Проверить ещё раз');retry.onclick=()=>void this.load();this.host.append(retry);
    }
  }
  private mountIfReady(){
    if(this.destroyed||this.child||client.loading||this.loading)return;
    if(client.accountId&&!client.wallet)return;
    const session=client.sessions.find(s=>s.gameId===this.game),pending=client.pending;
    const oldPending=pending?.gameId===this.game&&(pending.action==='start'?!(this.game===CARAMEL_GAME?validCaramelSettings(pending.settings):isLuelonSlotGame(this.game)?validLuelonSlotSettings(this.game,pending.settings):false):pending.revision===undefined&&session?.rulesVersion!==2);
    this.mount(!!oldPending||session?.rulesVersion===1&&session.state==='active');
  }
  private mount(legacy:boolean){
    this.child?.destroy();this.child=undefined;this.host.replaceChildren();this.legacy=legacy;
    if(!legacy){this.status=undefined;this.upgrade=undefined;this.child=this.current(this.host);return;}
    const banner=document.createElement('div'),text=document.createElement('p'),button=document.createElement('button'),body=document.createElement('div');
    banner.className='cosmic-legacy-notice';text.setAttribute('role','status');button.type='button';button.textContent=translateText('Открыть новую версию');
    button.onclick=()=>{if(!button.disabled)this.mount(false);};banner.append(text,button);this.host.append(banner,body);this.status=text;this.upgrade=button;
    body.addEventListener('click',event=>{
      if(!(event.target instanceof Element)||!event.target.closest('[data-start]'))return;
      const current=client.sessions.find(s=>s.gameId===this.game);
      if(current?.state!=='active'&&!client.pending&&!client.busy){event.preventDefault();event.stopImmediatePropagation();this.mount(false);}
    },true);
    this.child=this.old(body);this.change();
  }
  destroy(){this.destroyed=true;client.removeEventListener('change',this.change);this.child?.destroy();this.child=undefined;this.host.replaceChildren();}
}
