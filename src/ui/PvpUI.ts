import { PvpClient } from '../network/PvpClient';
import { ACTIVITIES, type ActivityId } from '../shared/activities';
import { PVP_GAMES, isPvpSnapshotGame, isDirectPvp, isFreePvp, pvpPayout, validVirtualPvpWallet, validVirtualPvpStake, type PvpChallenge, type PvpGameId, type PvpRequest } from '../shared/pvp';
import { activityHall, hallLinks, type HallId, type PlayerView } from '../shared/world';
import type { TsuEFaTarget } from '../shared/tsuEFa';
import { PlayerDuelMenu } from './PlayerDuelMenu';
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
  private playerMenu:PlayerDuelMenu;
  private incoming=document.createElement('dialog');private seenInvites=new Set<string>();
  private autoOpened='';private autoReady=new Set<string>();private composing=false;
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
      <div data-tsu-terms hidden><label>Условия<select name="mode"><option value="free">Бесплатно</option><option value="stake">Со ставкой</option></select></label><label>Матч до побед<select name="targetWins"><option value="3">3 побед</option><option value="5">5 побед</option><option value="7">7 побед</option></select></label></div>
      <label data-stake-field>Твоя ставка, USDT<input name="stake" inputmode="decimal" type="text" value="50" required autocomplete="off"></label>
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
    form.onsubmit=event=>{event.preventDefault();this.run(()=>{
      const gameId=(form.elements.namedItem('game')as HTMLSelectElement).value as PvpGameId,mode=(form.elements.namedItem('mode')as HTMLSelectElement).value as 'free'|'stake';
      this.client.send({id:crypto.randomUUID(),action:'create',gameId,
        stakeUnits:gameId==='tsu-e-fa'&&mode==='free'?'0':usdtUnits((form.elements.namedItem('stake')as HTMLInputElement).value.trim().replace(',','.')),
        targetId:(form.elements.namedItem('target')as HTMLSelectElement).value||null,
        ...(gameId==='tsu-e-fa'?{mode,targetWins:Number((form.elements.namedItem('targetWins')as HTMLSelectElement).value)as TsuEFaTarget}:{})});
    });};
    this.playerMenu=new PlayerDuelMenu(scene,this.client,account=>{
      this.composing=true;this.show();
      (form.elements.namedItem('game')as HTMLSelectElement).value='tsu-e-fa';
      (form.elements.namedItem('target')as HTMLSelectElement).value=account;
      (form.elements.namedItem('mode')as HTMLSelectElement).value='free';
      this.preview();this.update();
    });
    this.incoming.id='pvp-incoming';this.incoming.className='pvp-incoming';this.incoming.setAttribute('aria-labelledby','pvp-incoming-title');document.body.append(this.incoming);
    this.incoming.addEventListener('close',()=>this.scene.setLocked(!!document.querySelector('dialog[open]')));
    this.client.addEventListener('change',()=>this.update());
    window.addEventListener('royal-account',event=>{
      const account=(event as CustomEvent<string|null>).detail;
      if(account===this.client.accountId)return;
      this.playerMenu.reset();this.incoming.close();this.seenInvites.clear();this.autoOpened='';this.autoReady.clear();this.dialog.close();this.travelId='';this.openedId='';this.client.setAccount(account);
    });
    activities.pvpOpen=id=>{
      if(id==='piano')return false;
      const active=this.client.snapshot?.active;
      if(active?.status==='playing'&&active.gameId===id&&!isPvpSnapshotGame(id)){this.openPhysics(active);return true;}
      (form.elements.namedItem('game')as HTMLSelectElement).value=id;this.show();return true;
    };
    this.tick=setInterval(()=>{this.playerMenu.tick();this.route();this.renderCountdown();this.offerIncoming();},250);this.preview();
  }
  updatePlayers(players:PlayerView[],self:string){this.playerMenu.update(players,self);}
  openPlayer(id:string){this.playerMenu.open(id);}
  private offerIncoming(){
    const invitation=this.client.snapshot?.challenges.find(c=>c.status==='open'&&isDirectPvp(c)&&c.targetId===this.client.accountId&&!this.seenInvites.has(c.id));
    if(this.incoming.open){const id=this.incoming.dataset.match;if(!this.client.snapshot?.challenges.some(c=>c.id===id&&c.status==='open'))this.incoming.close();return;}
    if(!invitation||document.querySelector('dialog[open]')||!this.client.connected)return;
    this.seenInvites.add(invitation.id);this.incoming.dataset.match=invitation.id;
    this.incoming.innerHTML=`<h2 id="pvp-incoming-title">Приглашение в «Цу-е-фа»</h2><p>${escape(invitation.creatorName)} предлагает сыграть до ${invitation.targetWins??3} побед.</p><p>${isFreePvp(invitation)?'Бесплатная игра. Без списаний и комиссии.':`Твоя ставка ${money(invitation.stakeUnits)}. Победителю ${money(invitation.payoutUnits)}. Комиссия ${money(invitation.feeUnits)} (5%).`}</p><button type="button" data-accept>Принять приглашение</button><button type="button" data-decline>Отклонить</button><button type="button" data-later>Позже</button>`;
    this.incoming.querySelector<HTMLButtonElement>('[data-accept]')!.onclick=()=>{this.incoming.close();this.show();this.action('accept',invitation.id);};
    this.incoming.querySelector<HTMLButtonElement>('[data-decline]')!.onclick=()=>{this.incoming.close();this.action('cancel',invitation.id);};
    this.incoming.querySelector<HTMLButtonElement>('[data-later]')!.onclick=()=>this.incoming.close();
    this.scene.setLocked(true);this.incoming.showModal();
  }
  private run(action:()=>void){try{this.message='';action();}catch(error){this.message=error instanceof Error?error.message:'Не удалось выполнить действие.';this.update();}}
  private show(){this.scene.setLocked(true);if(!this.dialog.open)this.dialog.showModal();this.update();}
  private preview(){
    const tsu=this.body.querySelector<HTMLSelectElement>('[name=game]')!.value==='tsu-e-fa';
    const free=tsu&&this.body.querySelector<HTMLSelectElement>('[name=mode]')!.value==='free';
    this.body.querySelector<HTMLElement>('[data-tsu-terms]')!.hidden=!tsu;
    const input=this.body.querySelector<HTMLInputElement>('[name=stake]')!;input.disabled=free;input.required=!free;
    this.body.querySelector<HTMLElement>('[data-stake-field]')!.hidden=free;
    if(free){this.body.querySelector('[data-preview]')!.textContent='Бесплатная игра. Общий баланс не меняется, комиссии нет.';return;}
    try{const stake=usdtUnits(this.body.querySelector<HTMLInputElement>('[name=stake]')!.value.trim().replace(',','.')),payout=pvpPayout(stake);
      if(!validVirtualPvpStake(stake))throw Error();
      this.body.querySelector('[data-preview]')!.textContent=`Оба ставят по ${money(stake)}. Банк ${money(payout.potUnits)}. Победителю ${money(payout.payoutUnits)}, казино ${money(payout.feeUnits)}.`;
    }catch{this.body.querySelector('[data-preview]')!.textContent='Ставка от 1 до 500 USDT с шагом 0,10 USDT.';}
  }
  private action(action:'accept'|'cancel'|'ready'|'resign',id:string){this.run(()=>this.client.send({id:crypto.randomUUID(),action,challengeId:id}));}
  private update(){
    const snapshot=this.client.snapshot,c=snapshot?.active,self=this.client.accountId,busy=!!this.client.pending;
    if(c&&['open','arriving','playing'].includes(c.status))this.composing=false;
    const direct=!!c&&isDirectPvp(c);
    const directView=direct||this.composing||(!c||!['open','arriving','playing'].includes(c.status))&&this.body.querySelector<HTMLSelectElement>('[name=game]')!.value==='tsu-e-fa';
    this.dialog.dataset.direct=String(directView);
    this.body.querySelector('#pvp-title')!.textContent=directView?'Цу-е-фа':'Поединки';
    if(c&&direct&&['arriving','playing'].includes(c.status)&&this.autoOpened!==c.id){this.autoOpened=c.id;this.incoming.close();this.show();return;}
    if(c?.status==='arriving'&&!this.packages.has(c.id)){
      const id=c.id;this.packages.set(id,'loading');void prepareGameModule(c.gameId).then(ready=>{this.packages.set(id,ready?'ready':'failed');this.update();});
    }
    if(c&&['finished','cancelled'].includes(c.status)&&!isPvpSnapshotGame(c.gameId)&&this.openedId===c.id){this.openedId='';this.activities.closeWager();this.show();return;}
    const hasView=!!(snapshot?.cards||snapshot?.tsuEFa);
    const showModule=!this.composing&&!!c&&hasView&&(c.status==='playing'||c.gameId==='tsu-e-fa'&&['finished','cancelled'].includes(c.status));
    this.dialog.dataset.phase=c?.status??'lobby';this.dialog.dataset.cards=String(showModule);
    this.moduleRoot.hidden=!showModule;
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
    const panel=this.body.querySelector<HTMLElement>('[data-active]')!;panel.hidden=!c||this.composing;
    if(c){
      const opponent=c.creatorId===self?c.opponentName||'Ожидаем соперника':c.creatorName;
      const free=isFreePvp(c);
      const reason=c.status==='finished'?c.winnerId===null?free?'Ничья.':'Ничья. Ставка возвращена.':c.winnerId===self?free?'Ты победил.':`Ты победил. Начислено ${money(c.payoutUnits)}.`:'Соперник победил.':c.status==='cancelled'?free?'Приглашение отменено.':'Средства возвращены на общий баланс.':'';
      const html=`<div><h3>${escape(PVP_GAMES[c.gameId])}</h3><span>${escape(opponent)}</span></div><strong>${direct&&c.status==='arriving'?'Подготавливаем дуэль':free&&c.status==='cancelled'?'Приглашение отменено':states[c.status]}</strong><p>${free?'Бесплатная игра · Без комиссии':`Ставка ${money(c.stakeUnits)} · Банк ${money(c.potUnits)} · Победителю ${money(c.payoutUnits)} · Комиссия ${money(c.feeUnits)} (5%)`}${direct?` · До ${c.targetWins??3} побед`:''}</p>
        <p data-countdown></p>${c.disconnected.length?'<p>Связь с участником прервалась. Ожидаем возвращения.</p>':''}<p>${escape(reason)}</p><div class="pvp-active-actions">
        ${c.status==='open'||c.status==='arriving'?`<button type="button" data-pvp-action="cancel" data-id="${c.id}" ${busy?'disabled':''}>Отменить вызов</button>`:''}
        ${c.status==='arriving'?`${direct?'':`<button type="button" data-route>Идти к столу</button><button type="button" class="primary-button" data-pvp-action="ready" data-id="${c.id}" ${busy||c.ready.includes(self!)||this.packages.get(c.id)!=='ready'?'disabled':''}>${c.ready.includes(self!)?'Готовность подтверждена':this.packages.get(c.id)==='ready'?'Я готов за столом':'Подготавливаем игру…'}</button>`}${this.packages.get(c.id)==='failed'?'<button type="button" data-prepare>Повторить загрузку игры</button>':''}`:''}
        ${c.status==='playing'?`${!isPvpSnapshotGame(c.gameId)?'<button type="button" class="primary-button" data-open-table>Открыть стол</button>':''}<button type="button" data-pvp-action="resign" data-id="${c.id}" ${busy?'disabled':''}>Сдаться</button>`:''}</div>`;
      if(panel.dataset.render!==html){panel.innerHTML=html;panel.dataset.render=html;}
      const route=panel.querySelector<HTMLButtonElement>('[data-route]');if(route)route.onclick=()=>{this.travelId=c.id;this.routeHall='';this.dialog.close();this.route();};
      const open=panel.querySelector<HTMLButtonElement>('[data-open-table]');if(open)open.onclick=()=>this.openPhysics(c);
      const prepare=panel.querySelector<HTMLButtonElement>('[data-prepare]');if(prepare)prepare.onclick=()=>{this.packages.delete(c.id);this.autoReady.delete(c.id);this.update();};
      if(c.status==='arriving'&&!direct&&this.travelId!==c.id){this.travelId=c.id;this.routeHall='';this.dialog.close();}
      if(c.status==='arriving'&&direct&&this.packages.get(c.id)==='ready'&&!busy&&this.client.connected&&!c.ready.includes(self!)&&!this.autoReady.has(c.id)){
        this.autoReady.add(c.id);queueMicrotask(()=>{if(this.client.snapshot?.active?.id===c.id&&this.client.snapshot.active.status==='arriving'&&!this.client.pending)this.action('ready',c.id);else this.autoReady.delete(c.id);});
      }
      if(c.status==='playing'&&!isPvpSnapshotGame(c.gameId)&&this.openedId!==c.id){this.openedId=c.id;this.openPhysics(c);}
      if(showModule&&isPvpSnapshotGame(c.gameId)&&this.dialog.open){
        if(this.moduleId!==c.id){this.module?.destroy();this.moduleId=c.id;
          this.module=new IndependentGameUI(this.moduleRoot,c.gameId,{pvp:{get:()=>this.client.snapshot,busy:()=>!!this.client.pending,
            subscribe:callback=>{this.client.addEventListener('change',callback);return()=>this.client.removeEventListener('change',callback);},
            move:move=>this.run(()=>this.client.send({id:crypto.randomUUID(),action:'move',challengeId:c.id,revision:(this.client.snapshot!.tsuEFa??this.client.snapshot!.cards)!.revision,move}))}});
        }
      }else if(this.module&&(!showModule||!this.dialog.open)){this.module.destroy();this.module=undefined;this.moduleId='';}
    }
    const invitations=snapshot?.challenges.filter(item=>item.status==='open'&&item.creatorId!==self)??[];
    const list=this.body.querySelector<HTMLElement>('[data-list]')!,listHtml=invitations.length?invitations.map(item=>`<article><div><strong>${escape(PVP_GAMES[item.gameId])}</strong><span>${escape(item.creatorName)}${item.targetId?' · Приглашает тебя':''}</span></div><p>${isFreePvp(item)?'Бесплатная игра · Без комиссии':`Ставка ${money(item.stakeUnits)} · Победителю ${money(item.payoutUnits)}`}${isDirectPvp(item)?` · До ${item.targetWins??3} побед`:''}</p><button type="button" class="primary-button" data-pvp-action="accept" data-id="${item.id}" ${busy?'disabled':''}>Принять приглашение</button>${item.targetId?`<button type="button" data-pvp-action="cancel" data-id="${item.id}">Отклонить</button>`:''}</article>`).join(''):'<p class="pvp-empty">Пока нет открытых вызовов. Создай свой стол или пригласи игрока.</p>';
    if(list.dataset.render!==listHtml){list.innerHTML=listHtml;list.dataset.render=listHtml;}
    this.body.querySelectorAll<HTMLButtonElement>('[data-pvp-action]').forEach(button=>button.onclick=()=>this.action(button.dataset.pvpAction as 'accept'|'cancel'|'ready'|'resign',button.dataset.id!));
    this.renderCountdown();
  }
  private renderCountdown(){const c=this.client.snapshot?.active,output=this.body.querySelector('[data-countdown]');if(!c||!output)return;
    const remaining=Math.max(0,Math.ceil((c.expiresAt-this.client.now())/1000));output.textContent=c.status==='open'?`На принятие вызова: ${remaining} сек.`:c.status==='arriving'?`${isDirectPvp(c)?'На подготовку игры':'На встречу за столом'}: ${remaining} сек.`:c.status==='playing'&&isPvpSnapshotGame(c.gameId)?`${c.gameId==='tsu-e-fa'?'На выбор обоих':'На ход'}: ${remaining} сек.`:'';}
  private openPhysics(c:PvpChallenge){
    this.dialog.close();const shell=this.activities.openWager(c.gameId as ActivityId);if(!shell)return;
    const bar=document.createElement('div');bar.className='pvp-wager-bar';bar.textContent=`Банк ${money(c.potUnits)} · Победителю ${money(c.payoutUnits)} · Комиссия ${money(c.feeUnits)}`;
    const surrender=document.createElement('button');surrender.type='button';surrender.textContent='Сдаться';surrender.onclick=()=>this.action('resign',c.id);bar.append(surrender);
    shell.querySelector('.game-chat-game')?.prepend(bar);
  }
  private route(){
    const c=this.client.snapshot?.active;if(!c||isDirectPvp(c)||c.id!==this.travelId||c.status!=='arriving'){this.travelId='';return;}
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
  destroy(){clearInterval(this.tick);this.playerMenu.destroy();this.incoming.close();this.incoming.remove();this.module?.destroy();this.dialog.close();this.dialog.remove();this.button.remove();}
}
