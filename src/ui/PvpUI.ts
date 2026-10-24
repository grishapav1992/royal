import { PvpClient } from '../network/PvpClient';
import { ACTIVITIES, type ActivityId } from '../shared/activities';
import { PVP_GAMES, isPvpCardGame, pvpPayout, validVirtualPvpWallet, validVirtualPvpStake, type PvpChallenge, type PvpGameId, type PvpRequest } from '../shared/pvp';
import { activityHall, hallLinks, type HallId } from '../shared/world';
import { formatNileUnits } from '../shared/nileWallet';
import { usdtUnits } from '../shared/cryptoWallet';
import { demoWallet } from '../wallet/WalletClient';
import { IndependentGameUI } from '../modules/IndependentGameUI';
import type { RoomScene } from '../game/RoomScene';
import type { ActivitiesUI } from './ActivitiesUI';
import { registerGameChatDialog } from './GameChat';
import './pvp.css';
import {pvpSeat} from '../shared/pvpSeats';
import {prepareGameModule} from '../modules/GameModulePreparation';

const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(units:string)=>formatNileUnits(units)+' USDT';
const states:Record<PvpChallenge['status'],string>={open:'Ожидает соперника',arriving:'Встреча за столом',playing:'Партия идёт',finished:'Партия завершена',cancelled:'Ставки возвращены'};
export class PvpUI {
  readonly client:PvpClient;
  private button=document.createElement('button');
  private dialog=document.createElement('dialog');
  private body=document.createElement('div');
  private moduleRoot=document.createElement('div');
  private module?:IndependentGameUI;private moduleId='';
  private travelId='';private routeHall='';private openedId='';private message='';
  private packages=new Map<string,'loading'|'ready'|'failed'>();
  private tick:ReturnType<typeof setInterval>;
  constructor(private scene:RoomScene,private activities:ActivitiesUI,transport:(value:PvpRequest)=>boolean){
    this.client=new PvpClient(transport);
    this.button.id='pvp-button';this.button.type='button';this.button.hidden=true;this.button.className='wallet-button';this.button.textContent='Поединки';
    this.button.onclick=()=>this.show();document.querySelector('.profile')!.prepend(this.button);
    this.dialog.id='pvp-dialog';this.dialog.className='pvp-dialog';this.dialog.setAttribute('aria-labelledby','pvp-title');
    this.body.className='pvp-content';this.body.innerHTML=`<header class="pvp-heading"><div><small>ROYAL · 1 НА 1</small><h2 id="pvp-title">Поединки</h2></div><button type="button" data-close aria-label="Вернуться в зал">×</button></header>
      <div class="pvp-balance"><span>Общий баланс</span><strong data-balance>…</strong><small data-reserved></small><button type="button" data-wallet>Пополнить USDT</button></div>
      <p class="pvp-message" role="status" data-message></p><button type="button" class="primary-button" data-retry hidden>Проверить отправленное действие</button>
      <section class="pvp-active" data-active hidden></section><div data-card-module></div>
      <form class="pvp-create" data-create><h3>Новый вызов</h3><label>Игра<select name="game">${Object.entries(PVP_GAMES).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label>
      <label>Твоя ставка, USDT<input name="stake" inputmode="decimal" type="text" value="50" required autocomplete="off"></label>
      <label>Соперник<select name="target"><option value="">Открытый стол для любого игрока</option></select></label>
      <p class="pvp-preview" data-preview></p><button type="submit" class="primary-button" data-create-button>Создать вызов</button></form>
      <section data-invites><h3>Открытые столы и приглашения</h3><div class="pvp-challenges" data-list></div></section>
      <p class="pvp-note">Ставка автора резервируется сразу, ставка соперника при принятии. Комиссия казино: 5% от общего банка. При ничьей или отмене до начала обе ставки возвращаются. После разрыва связи есть 60 секунд на возвращение.</p>`;
    this.dialog.append(this.body);document.body.append(this.dialog);this.moduleRoot=this.body.querySelector('[data-card-module]')!;
    registerGameChatDialog(this.dialog);
    this.body.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>this.dialog.close();
    this.body.querySelector<HTMLButtonElement>('[data-wallet]')!.onclick=()=>{this.dialog.close();window.dispatchEvent(new Event('royal-open-wallet'));};
    this.body.querySelector<HTMLButtonElement>('[data-retry]')!.onclick=()=>this.client.retry();
    this.dialog.addEventListener('close',()=>{this.module?.destroy();this.module=undefined;this.moduleId='';this.scene.setLocked(!!document.querySelector('dialog[open]'));});
    const form=this.body.querySelector<HTMLFormElement>('[data-create]')!;
    form.addEventListener('input',()=>this.preview());
    form.onsubmit=event=>{event.preventDefault();this.run(()=>this.client.send({id:crypto.randomUUID(),action:'create',gameId:(form.elements.namedItem('game')as HTMLSelectElement).value as PvpGameId,
      stakeUnits:usdtUnits((form.elements.namedItem('stake')as HTMLInputElement).value.trim().replace(',','.')),targetId:(form.elements.namedItem('target')as HTMLSelectElement).value||null}));};
    this.client.addEventListener('change',()=>this.update());
    window.addEventListener('royal-account',event=>{this.dialog.close();this.travelId='';this.openedId='';this.client.setAccount((event as CustomEvent<string|null>).detail);});
    activities.pvpOpen=id=>{
      if(id==='piano')return false;
      const active=this.client.snapshot?.active;
      if(active?.status==='playing'&&active.gameId===id&&!isPvpCardGame(id)){this.openPhysics(active);return true;}
      (form.elements.namedItem('game')as HTMLSelectElement).value=id;this.show();return true;
    };
    this.tick=setInterval(()=>{this.route();this.renderCountdown();},250);this.preview();
  }
  private run(action:()=>void){try{this.message='';action();}catch(error){this.message=error instanceof Error?error.message:'Не удалось выполнить действие.';this.update();}}
  private show(){this.scene.setLocked(true);if(!this.dialog.open)this.dialog.showModal();this.update();}
  private preview(){
    try{const stake=usdtUnits(this.body.querySelector<HTMLInputElement>('[name=stake]')!.value.trim().replace(',','.')),payout=pvpPayout(stake);
      if(!validVirtualPvpStake(stake))throw Error();
      this.body.querySelector('[data-preview]')!.textContent=`Оба ставят по ${money(stake)}. Банк ${money(payout.potUnits)}. Победителю ${money(payout.payoutUnits)}, казино ${money(payout.feeUnits)}.`;
    }catch{this.body.querySelector('[data-preview]')!.textContent='Ставка от 1 до 500 USDT с шагом 0,10 USDT.';}
  }
  private action(action:'accept'|'cancel'|'ready'|'resign',id:string){this.run(()=>this.client.send({id:crypto.randomUUID(),action,challengeId:id}));}
  private update(){
    const snapshot=this.client.snapshot,c=snapshot?.active,self=this.client.accountId,busy=!!this.client.pending;
    if(c?.status==='arriving'&&!this.packages.has(c.id)){
      const id=c.id;this.packages.set(id,'loading');void prepareGameModule(c.gameId).then(ready=>{this.packages.set(id,ready?'ready':'failed');this.update();});
    }
    if(c&&['finished','cancelled'].includes(c.status)&&!isPvpCardGame(c.gameId)&&this.openedId===c.id){this.openedId='';this.activities.closeWager();this.show();return;}
    this.dialog.dataset.phase=c?.status??'lobby';this.dialog.dataset.cards=String(c?.status==='playing'&&!!snapshot?.cards);
    this.moduleRoot.hidden=c?.status!=='playing';
    this.button.hidden=!self;
    this.button.textContent=c&&['open','arriving','playing'].includes(c.status)?'Мой поединок':`Поединки${snapshot?.challenges.some(c=>c.status==='open'&&c.creatorId!==self)?' · Есть вызовы':''}`;
    if(snapshot&&self&&validVirtualPvpWallet(snapshot.wallet))demoWallet.acceptExternalWallet(self,snapshot.wallet.wallet);
    const wallet=snapshot?.wallet;
    this.body.querySelector('[data-balance]')!.textContent=wallet?.state==='assigned'?money(wallet.balanceUnits):'Кошелёк не подключён';
    this.body.querySelector('[data-reserved]')!.textContent=wallet?.state==='assigned'&&wallet.reservedUnits&&wallet.reservedUnits!=='0'?'В ставках: '+money(wallet.reservedUnits):'';
    this.body.querySelector('[data-message]')!.textContent=this.message||this.client.error||(!this.client.connected?'Нет связи с залом. Действия сохраняются до повторной проверки.':busy?'Действие отправлено. Дождись подтверждения.':'');
    this.body.querySelector<HTMLButtonElement>('[data-retry]')!.hidden=!busy;
    const form=this.body.querySelector<HTMLFormElement>('[data-create]')!,active=!!c&&['open','arriving','playing'].includes(c.status);
    form.hidden=active;this.body.querySelector<HTMLElement>('[data-invites]')!.hidden=active;
    form.querySelector<HTMLButtonElement>('[data-create-button]')!.disabled=busy||!this.client.connected||wallet?.state!=='assigned'||!wallet.ready;
    const select=form.elements.namedItem('target')as HTMLSelectElement,selected=select.value;
    const options='<option value="">Открытый стол для любого игрока</option>'+(snapshot?.people??[]).map(p=>`<option value="${escape(p.accountId)}" ${!p.available?'disabled':''}>${escape(p.name)}${!p.available?' · занят':''}</option>`).join('');
    if(select.innerHTML!==options){select.innerHTML=options;select.value=Array.from(select.options).some(o=>o.value===selected)?selected:'';}
    const panel=this.body.querySelector<HTMLElement>('[data-active]')!;panel.hidden=!c;
    if(c){
      const opponent=c.creatorId===self?c.opponentName||'Ожидаем соперника':c.creatorName;
      const reason=c.status==='finished'?c.winnerId===null?'Ничья. Ставка возвращена.':c.winnerId===self?`Ты победил. Начислено ${money(c.payoutUnits)}.`:'Соперник победил.':c.status==='cancelled'?'Средства возвращены на общий баланс.':'';
      const html=`<div><h3>${escape(PVP_GAMES[c.gameId])}</h3><span>${escape(opponent)}</span></div><strong>${states[c.status]}</strong><p>Ставка ${money(c.stakeUnits)} · Банк ${money(c.potUnits)} · Победителю ${money(c.payoutUnits)} · Комиссия ${money(c.feeUnits)} (5%)</p>
        <p data-countdown></p>${c.disconnected.length?'<p>Связь с участником прервалась. Ожидаем возвращения.</p>':''}<p>${escape(reason)}</p><div class="pvp-active-actions">
        ${c.status==='open'||c.status==='arriving'?`<button type="button" data-pvp-action="cancel" data-id="${c.id}" ${busy?'disabled':''}>Отменить вызов</button>`:''}
        ${c.status==='arriving'?`<button type="button" data-route>Идти к столу</button><button type="button" class="primary-button" data-pvp-action="ready" data-id="${c.id}" ${busy||c.ready.includes(self!)||this.packages.get(c.id)!=='ready'?'disabled':''}>${c.ready.includes(self!)?'Готовность подтверждена':this.packages.get(c.id)==='ready'?'Я готов за столом':'Подготавливаем игру…'}</button>${this.packages.get(c.id)==='failed'?'<button type="button" data-prepare>Повторить загрузку игры</button>':''}`:''}
        ${c.status==='playing'?`${!isPvpCardGame(c.gameId)?'<button type="button" class="primary-button" data-open-table>Открыть стол</button>':''}<button type="button" data-pvp-action="resign" data-id="${c.id}" ${busy?'disabled':''}>Сдаться</button>`:''}</div>`;
      if(panel.dataset.render!==html){panel.innerHTML=html;panel.dataset.render=html;}
      const route=panel.querySelector<HTMLButtonElement>('[data-route]');if(route)route.onclick=()=>{this.travelId=c.id;this.routeHall='';this.dialog.close();this.route();};
      const open=panel.querySelector<HTMLButtonElement>('[data-open-table]');if(open)open.onclick=()=>this.openPhysics(c);
      const prepare=panel.querySelector<HTMLButtonElement>('[data-prepare]');if(prepare)prepare.onclick=()=>{this.packages.delete(c.id);this.update();};
      if(c.status==='arriving'&&this.travelId!==c.id){this.travelId=c.id;this.routeHall='';this.dialog.close();}
      if(c.status==='playing'&&!isPvpCardGame(c.gameId)&&this.openedId!==c.id){this.openedId=c.id;this.openPhysics(c);}
      if(c.status==='playing'&&isPvpCardGame(c.gameId)&&snapshot?.cards&&this.dialog.open){
        if(this.moduleId!==c.id){this.module?.destroy();this.moduleId=c.id;
          this.module=new IndependentGameUI(this.moduleRoot,c.gameId,{pvp:{get:()=>this.client.snapshot,busy:()=>!!this.client.pending,
            subscribe:callback=>{this.client.addEventListener('change',callback);return()=>this.client.removeEventListener('change',callback);},
            move:move=>this.run(()=>this.client.send({id:crypto.randomUUID(),action:'move',challengeId:c.id,revision:this.client.snapshot!.cards!.revision,move}))}});
        }
      }else if(this.module&&(c.status!=='playing'||!snapshot?.cards||!this.dialog.open)){this.module.destroy();this.module=undefined;this.moduleId='';}
    }
    const invitations=snapshot?.challenges.filter(item=>item.status==='open'&&item.creatorId!==self)??[];
    const list=this.body.querySelector<HTMLElement>('[data-list]')!,listHtml=invitations.length?invitations.map(item=>`<article><div><strong>${escape(PVP_GAMES[item.gameId])}</strong><span>${escape(item.creatorName)}${item.targetId?' · Приглашает тебя':''}</span></div><p>Ставка ${money(item.stakeUnits)} · Победителю ${money(item.payoutUnits)}</p><button type="button" class="primary-button" data-pvp-action="accept" data-id="${item.id}" ${busy?'disabled':''}>Принять ставку</button>${item.targetId?`<button type="button" data-pvp-action="cancel" data-id="${item.id}">Отклонить</button>`:''}</article>`).join(''):'<p class="pvp-empty">Пока нет открытых вызовов. Создай свой стол или пригласи игрока.</p>';
    if(list.dataset.render!==listHtml){list.innerHTML=listHtml;list.dataset.render=listHtml;}
    this.body.querySelectorAll<HTMLButtonElement>('[data-pvp-action]').forEach(button=>button.onclick=()=>this.action(button.dataset.pvpAction as 'accept'|'cancel'|'ready'|'resign',button.dataset.id!));
    this.renderCountdown();
  }
  private renderCountdown(){const c=this.client.snapshot?.active,output=this.body.querySelector('[data-countdown]');if(!c||!output)return;
    const remaining=Math.max(0,Math.ceil((c.expiresAt-this.client.now())/1000));output.textContent=c.status==='open'?`На принятие вызова: ${remaining} сек.`:c.status==='arriving'?`На встречу за столом: ${remaining} сек.`:c.status==='playing'&&isPvpCardGame(c.gameId)?`На ход: ${remaining} сек.`:'';}
  private openPhysics(c:PvpChallenge){
    this.dialog.close();const shell=this.activities.openWager(c.gameId as ActivityId);if(!shell)return;
    const bar=document.createElement('div');bar.className='pvp-wager-bar';bar.textContent=`Банк ${money(c.potUnits)} · Победителю ${money(c.payoutUnits)} · Комиссия ${money(c.feeUnits)}`;
    const surrender=document.createElement('button');surrender.type='button';surrender.textContent='Сдаться';surrender.onclick=()=>this.action('resign',c.id);bar.append(surrender);
    shell.querySelector('.game-chat-game')?.prepend(bar);
  }
  private route(){
    const c=this.client.snapshot?.active;if(!c||c.id!==this.travelId||c.status!=='arriving'){this.travelId='';return;}
    if(this.dialog.open||document.querySelector('dialog[open]'))return;
    const targetHall=activityHall(c.gameId),entry=pvpSeat(c.gameId,c.creatorId===this.client.accountId?0:1);
    if(this.scene.hall===targetHall&&Math.hypot(this.scene.player.x-entry.x,this.scene.player.y-entry.y)<60){this.show();return;}
    if(this.routeHall===this.scene.hall)return;this.routeHall=this.scene.hall;
    if(this.scene.hall===targetHall){this.scene.goTo(entry);return;}
    const queue:{hall:HallId;path:HallId[]}[]=[{hall:this.scene.hall,path:[]}],seen=new Set<HallId>();
    while(queue.length){const next=queue.shift()!;if(seen.has(next.hall))continue;seen.add(next.hall);
      if(next.hall===targetHall){this.scene.approachFloor(next.path[0]);break;}
      for(const link of hallLinks(next.hall))queue.push({hall:link.target,path:[...next.path,link.target]});
    }
  }
  destroy(){clearInterval(this.tick);this.module?.destroy();this.dialog.close();this.dialog.remove();this.button.remove();}
}
