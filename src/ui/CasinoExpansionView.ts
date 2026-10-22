import { decorateImportedGame } from './ImportedGameThemes';
import { t as translateText, tr, locale } from '../i18n/index';
import { resetGameOutcomes } from './gameReactions';
import {CasinoConfirmedMotion} from './CasinoConfirmedMotion';
import { EXPANSION_NAMES, EXPANSION_RULES, LEGACY_CARD_RULES, type ExpansionGameId } from '../shared/casinoExpansion';
import { DEMO_BETS } from '../shared/demoWallet';
import { expansionClient as client, type NewExpansionAction } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { emitExpansionDealer } from './CardDealerStage';
import './casino-expansion.css';
const escape=(s:string)=>translateText(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const amount=(units:string|number)=>(Number(units)/100).toLocaleString(locale,{maximumFractionDigits:2})+translateText(' монет');
export class CasinoExpansionView {
  private motion?: CasinoConfirmedMotion;
  private stake='1000';private side=false;private bet!:'dragon'|'tiger'|'small'|'big';private selected=new Set<number>();private error='';private sessionId='';private phase=-1;private timer!:ReturnType<typeof setInterval>;private destroyed=false;
  private change=()=>this.render();
  constructor(private host:HTMLElement,private game:ExpansionGameId){
    resetGameOutcomes(host);
    this.motion=CasinoConfirmedMotion.forGame(host,game,()=>this.render());
    this.bet=game==='github-sic-bo'?'small':'dragon';client.addEventListener('change',this.change);demoWallet.addEventListener('change',this.change);
    this.render();void client.refresh();this.timer=setInterval(()=>{if(this.game==='github-crash'&&!client.pending&&!client.busy&&client.sessions.some(s=>s.gameId===this.game&&s.state==='active'))void client.refresh();},400);
  }
  private async act(op:NewExpansionAction){if(this.motion?.active)return;this.error='';try{await (this.motion?this.motion.run(op,()=>client.act(op)):client.act(op));this.selected.clear();}catch(e){this.error=(e as Error).message;}if(!this.destroyed)this.render();}
  private render(){
    if(this.destroyed||this.motion?.guardRender())return;const current=client.sessions.find(s=>s.gameId===this.game),s=this.motion?this.motion.session(current):current,playing=s?.state==='active',blocked=client.busy||!!client.pending||!!this.motion?.active;
    if(s?.id!==this.sessionId||s?.view.phase!==this.phase){this.sessionId=s?.id??'';this.phase=s?.view.phase??-1;this.selected.clear();}if(playing)this.stake=s.stakeUnits;
    const balance=this.motion?this.motion.balance(demoWallet.wallet?.balance??client.wallet?.balance):demoWallet.wallet?.balance??client.wallet?.balance,ready=!!client.accountId&&balance!==undefined;
    const legacy=!!s&&s.rulesVersion===1&&!!LEGACY_CARD_RULES[this.game];
    const rules=legacy?LEGACY_CARD_RULES[this.game]!:EXPANSION_RULES[this.game];
    const card=(c:string,i:number,selectable=false)=>tr`<button class="expansion-card ${'HD'.includes(c[1])?'red':''} ${selectable&&this.selected.has(i)?'held':''}" data-card="${i}" ${!selectable||!playing||blocked?'disabled':''} aria-pressed="${selectable&&this.selected.has(i)}" aria-label="Карта ${i+1}: ${escape(c)}"><b>${c==='JK'?'★':c[0]==='T'?'10':escape(c[0])}</b><span>${c==='JK'?translateText('Джокер'):({S:'♠',C:'♣',H:'♥',D:'♦'} as Record<string,string>)[c[1]]??'♛'}</span>${selectable?'<small>'+ (this.selected.has(i)?this.game==='github-pai-gow'?translateText('Младшая'):this.game==='github-deuces'?translateText('Удержана'):translateText('Выбрана'):translateText('Выбрать'))+'</small>':''}</button>`;
    const selection=s?.view.actions.find(a=>a.maxPicks!==undefined);const selectable=['github-deuces','github-pai-gow'].includes(this.game)||!!selection;
    const fee=(a:{cost:number;perPick?:number})=>a.cost+(a.perPick??0)*this.selected.size;
    let board='';
    if(this.game==='github-crash'){
      const waiting=playing&&s.startedAt!>s.serverNow!,seconds=waiting?Math.ceil((s.startedAt!-s.serverNow!)/1000):0;
      board=`<div class="expansion-flight ${s?.state==='settled'&&Number(s.returnedUnits)===0?'crashed':''}"><span>✦</span><strong>${waiting?translateText('Старт через ')+seconds:(s?.multiplier??1).toFixed(2)+'×'}</strong><small>${s?.state==='settled'?translateText('Раунд завершён'):playing?translateText('Забери до остановки'):translateText('Готов к полёту')}</small></div>`;
    }else if(this.game==='github-diamonds')board=`<div class="expansion-gems">${(s?.gems??['◇','◇','◇','◇','◇']).map(g=>'<span>'+escape(g)+'</span>').join('')}</div>`;
    else if(this.game==='github-sic-bo')board=`<div class="expansion-dice">${(s?.dice??[0,0,0]).map(n=>'<span>'+ (n?['','⚀','⚁','⚂','⚃','⚄','⚅'][n]:'?')+'</span>').join('')}</div>`;
    else {
      board=`<div class="expansion-hand"><span>${this.game==='github-dragon-tiger'?translateText('Дракон'):this.game==='github-andar-bahar'?translateText('Карта-ориентир'):translateText('Твои карты')}</span><div>${s?.view.player.map((c,i)=>card(c,i,selectable)).join('')||'<div class="expansion-back">♛</div>'}</div></div>`;
      if(s?.view.hands?.length){const hands=s.view.hands.map(h=>`<div class="expansion-hand ${h.active?'active-hand':''}"><span>${escape(h.label)}${this.game==='github-andar-bahar'?'':' · '+h.score+translateText(' очков')}${h.active?translateText(' · Твой ход'):''}</span><div>${h.cards.map((c,i)=>card(c,i)).join('')}</div></div>`).join('');board=this.game==='github-andar-bahar'?board+hands:hands;}
      if(s?.view.community.length)board+=`<div class="expansion-hand"><span>${this.game==='github-pai-gow'?translateText('Младшая рука'):translateText('Общие / новые карты')}</span><div>${s.view.community.map((c,i)=>card(c,i)).join('')}</div></div>`;
      if(!['github-let-it-ride','github-deuces','github-red-dog','github-mississippi','github-andar-bahar'].includes(this.game))board+=`<div class="expansion-hand"><span>${this.game==='github-dragon-tiger'?translateText('Тигр'):translateText('Дилер')}</span><div>${s?.view.dealer.length?s.view.dealer.map((c,i)=>card(c,i)).join(''):'<div class="expansion-back">♛</div>'}</div></div>`;
    }
    const multiplier=['github-crazy-four','github-switch'].includes(this.game)?2:this.game==='github-let-it-ride'?3:this.game==='github-ultimate'?2+Number(this.side):this.game==='github-three-card'?1+Number(this.side):1;
    const status=!client.accountId?translateText('Войди в аккаунт, чтобы играть на общий демобаланс.'):!ready?translateText('Загружаем баланс…'):s?.state==='settled'?tr`Партия завершена. Ставки: ${amount(s.spentUnits)} · Возвращено: ${amount(s.returnedUnits)}`:playing?tr`Партия сохранена · Ставки: ${amount(s.spentUnits)} · Возвращено: ${amount(s.returnedUnits)}`:translateText('Выбери ставку и начни игру.');
    this.host.innerHTML=tr`<section class="casino-expansion" aria-label="${escape(EXPANSION_NAMES[this.game])}"><div class="expansion-toolbar"><strong data-expansion-balance>${balance===undefined?translateText('Баланс загружается'):balance.toLocaleString(locale)+translateText(' демомонет')}</strong><label>${['github-three-card','github-caribbean','github-ultimate'].includes(this.game)?'Ante':translateText('Ставка')}<select data-stake ${playing||blocked?'disabled':''}>${DEMO_BETS.map(n=>tr`<option value="${n*100}" ${String(n*100)===this.stake?'selected':''}>${n} монет</option>`).join('')}</select></label>${['github-three-card','github-ultimate'].includes(this.game)?tr`<label class="expansion-side"><input type="checkbox" data-side ${this.side?'checked':''} ${playing||blocked?'disabled':''}>${this.game==='github-three-card'?'Pair Plus':'Trips'}: ещё одна Ante</label>`:''}${['github-dragon-tiger','github-sic-bo'].includes(this.game)?tr`<label>Ставка на<select data-bet ${playing||blocked?'disabled':''}>${(this.game==='github-sic-bo'?[['small',translateText('Малое: 4-10')],['big',translateText('Большое: 11-17')]]:[['dragon',translateText('Дракон')],['tiger',translateText('Тигр')]]).map(([v,n])=>`<option value="${v}" ${v===this.bet?'selected':''}>${n}</option>`).join('')}</select></label>`:''}</div><div class="expansion-board">${board}</div><p class="expansion-message">${escape(s?.view.message??'')}${playing&&this.game==='github-deuces'?translateText(' Удержи нужные карты; остальные будут заменены.'):playing&&this.game==='github-pai-gow'?translateText(' Выбери две карты младшей руки.'):''}</p><p role="status">${status}</p><div class="expansion-actions">${playing?s.view.actions.map(a=>`<button data-move="${escape(a.move)}" ${blocked||!ready||fee(a)>(balance??0)*100||a.maxPicks!==undefined&&(this.selected.size<(a.minPicks??0)||this.selected.size>a.maxPicks)||a.move==='set'&&this.selected.size!==2||this.game==='github-crash'&&s.startedAt!>s.serverNow!?'disabled':''}>${escape(a.label)}${fee(a)?translateText('<small>Ещё ')+amount(fee(a))+'</small>':a.perPick?'<small>'+amount(a.perPick)+translateText(' за карту</small>'):''}</button>`).join(''):`<button data-start ${blocked||!ready||client.loading?'disabled':''}>${s?translateText('Новая партия'):translateText('Начать игру')} · ${amount(Number(this.stake)*multiplier)}</button>`}${client.pending?'<button data-retry '+(client.busy?'disabled':'')+translateText('>Проверить ход</button>'):''}<button data-refresh ${client.busy?'disabled':''}>Обновить</button></div><p class="expansion-error" role="alert">${escape(this.error||client.error)}</p><details><summary>Правила и выплаты</summary><p>${escape(rules)}${legacy?translateText(" Партия начата по прежним правилам. Новая партия использует исправленные правила."):""}</p><p>Общий тестовый кошелёк клуба. Ставки, возвраты и выигрыши видны в его истории. Незавершённая партия сохраняется при закрытии окна и перезагрузке.</p></details></section>`;
    decorateImportedGame(this.host.firstElementChild as HTMLElement, this.game);
    if(this.motion)this.motion.observeOutcome(current);else emitExpansionDealer(this.host,this.game,s,client.accountId,client.busy,!!client.pending);
    this.host.querySelector<HTMLSelectElement>('[data-stake]')!.onchange=e=>{this.stake=(e.target as HTMLSelectElement).value;this.render();};
    const side=this.host.querySelector<HTMLInputElement>('[data-side]');if(side)side.onchange=()=>{this.side=side.checked;this.render();};
    const bet=this.host.querySelector<HTMLSelectElement>('[data-bet]');if(bet)bet.onchange=()=>{this.bet=bet.value as 'dragon'|'tiger'|'small'|'big';};
    this.host.querySelectorAll<HTMLButtonElement>('[data-card]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.card);if(this.selected.has(n))this.selected.delete(n);else{if(this.selected.size>=(selection?.maxPicks??(this.game==='github-pai-gow'?2:5)))return;this.selected.add(n);}this.render();});
    this.host.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click',()=>void this.act({gameId:this.game,action:'start',stakeUnits:this.stake,settings:['github-three-card','github-ultimate'].includes(this.game)?{side:this.side}:['github-dragon-tiger','github-sic-bo'].includes(this.game)?{bet:this.bet}:{}}));
    this.host.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(b=>b.onclick=()=>{const move=b.dataset.move!;void this.act({gameId:this.game,action:'move',sessionId:s!.id,move,...(['hold','set','exchange','draw','discard'].includes(move)?{picks:[...this.selected].sort((a,b)=>a-b)}:{})});});
    this.host.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click',()=>void client.retry().catch(()=>{}));
    this.host.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick=()=>{this.error='';void client.refresh();};
    this.motion?.paint();
  }
  destroy(){this.motion?.destroy();this.destroyed=true;clearInterval(this.timer);client.removeEventListener('change',this.change);demoWallet.removeEventListener('change',this.change);this.host.replaceChildren();}
}
