import {GAME_STAKE_UNITS as CARIBBEAN_LINE_STAKES} from '../../src/shared/gameStakes';
import { readGameHost } from '../../src/modules/GameHostContract';
import {
  CARIBBEAN_GAME, caribbeanInitialCost, validCaribbeanStake,
  type CaribbeanSettings, type CaribbeanStartMode, type CaribbeanView,
} from '../../src/shared/caribbeanTreasures';
import {
  CARIBBEAN_LINE_COUNTS, CARIBBEAN_LINES, CARIBBEAN_SYMBOLS,
  validCaribbeanLineCount, type CaribbeanLineCount,
} from '../../src/shared/caribbeanTreasuresMath';
import { SlotDialog, slotOwnsKeyboard, type SlotDialogKind } from '../../src/ui/slotKit/SlotDialog';
import { caribbeanIcon } from './icons';
import {CaribbeanAudio,type CaribbeanCue} from './CaribbeanAudio';
import {caribbeanOutcome,caribbeanBeforeReveal} from './presentation';
import {CaribbeanCaptain} from './CaribbeanCaptain';
import {CARIBBEAN_CREW,DEFAULT_CAPTAIN,crewMember,crewThumbnail,type CrewId} from './CaribbeanCrew';
import {crewCollection,crewErrors} from './CaribbeanCollection';
import type {CrewCollection,CrewRequest} from '../../src/shared/caribbeanCrew';
import {CaribbeanMotion} from './CaribbeanMotion';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
const namesEn = ['Map','Compass','Pistol','Cutlass','Ruby','Parrot'];
const AUTO_COUNTS=[10,25,50,100] as const;
type AutoNote=''|'complete'|'stopped'|'funds'|'error'|'paused'|'account';
const portraitLayers='<span class="ct-portrait-gesture" data-pose="idle"><img class="ct-portrait-layer ct-current" src="/assets/caribbean-treasures/captain.webp" alt=""><img class="ct-portrait-layer" src="/assets/caribbean-treasures/captain.webp" alt=""></span>';
export class CaribbeanUI {
  private services = readGameHost();
  private client = this.services.expansionClient;
  private lifetime = new AbortController();
  private root: HTMLElement;
  private dialog: SlotDialog;
  private dialogKind: SlotDialogKind = '';
  private crewDialog=false;
  private choosingCaptain=false;
  private crewRequest=0;
  private crewProfile?:CrewCollection;
  private crewAbort=new AbortController();
  private crewLoad=0;
  private crewLoading=false;
  private crewBusy=false;
  private crewTab:'crew'|'tasks'='crew';
  private crewMessage='';
  private crewSuccess=false;
  private crewPendingCaptain?:CrewId;
  private crewNewlyUnlocked='';
  private crewFeedback='';
  private disposed = false;
  private lines: CaribbeanLineCount = 20;
  private lineStake = '10';
  private sessionKey = '';
  private account: string | null = null;
  private showLines = false;
  private audio = new CaribbeanAudio();
  private unsubscribeAudio:()=>void=()=>{};
  private motion = new AbortController();
  private presenting = false;
  private paused = false;
  private displayed?:CaribbeanView;
  private visualPhase = 'idle';
  private stopped = 6;
  private boardSignature='';
  private tally?:string;
  private actionError='';
  private autoCount:number=10;
  private autoRemaining=0;
  private autoRunning=false;
  private autoInFlight=false;
  private autoEpoch=0;
  private autoTimer?:ReturnType<typeof setTimeout>;
  private autoNote:AutoNote='';
  private lastBalance?:number;
  private captain:CaribbeanCaptain;
  private visuals:CaribbeanMotion;
  private accents:{cue:string;deviationMs:number;preparationMs:number;visualMs:number}[]=[];
  private motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
  private get reduced(){return this.motionPreference.matches;}
  private get english() { return this.services.i18n.language === 'en'; }
  private text(ru: string, en: string) { return this.english ? en : ru; }
  get title() { return this.text('Карибские сокровища','Caribbean Treasures'); }
  private money(units: string) { return this.services.walletCoins(Number(units) / 100); }
  private symbolName(symbol: number) { return this.english ? namesEn[symbol] : CARIBBEAN_SYMBOLS[symbol].name; }
  private get session() { return this.client.sessions.find(session => session.gameId === CARIBBEAN_GAME); }
  private get view() { return this.session?.view.caribbean; }
  private get active() { return this.session?.state === 'active'; }
  private get wallet() { return this.services.demoWallet.accountId===this.client.accountId ? this.services.demoWallet.wallet ?? this.client.wallet : undefined; }
  private canAfford(mode:CaribbeanStartMode) {
    return !!this.wallet && Math.round(this.wallet.balance*100)>=Number(caribbeanInitialCost({lines:this.lines,mode,stakeBasis:'total'},this.lineStake));
  }
  private get blocked() {
    return this.presenting || this.paused || !this.client.accountId || !this.client.wallet || this.client.busy || this.client.loading || !!this.client.pending
      || this.services.demoWallet.busy || !!this.services.demoWallet.pending || this.services.demoWallet.hasExternalBusy('expansion');
  }
  constructor(host: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'ct-root';
    this.root.setAttribute('aria-label',this.title);
    this.root.innerHTML = '<header class="ct-heading"><button type="button" class="ct-avatar" data-ct-action="crew"><span class="ct-avatar-body" aria-hidden="true">'+portraitLayers+'</span><span class="ct-crew-badge" aria-hidden="true">⇄</span></button><div class="ct-title"><small>ROYAL · CARIBBEAN</small><h2></h2></div><div class="ct-header-tools"><button type="button" data-ct-action="sound">♪</button><button type="button" data-ct-action="music">♫</button><button type="button" data-ct-action="info">?</button><button type="button" data-ct-action="history">≡</button></div></header>'
      + '<div class="ct-stage"><div class="ct-board-wrap"><div class="ct-board" role="img"></div><div class="ct-waiting" hidden></div></div><aside class="ct-captain" aria-hidden="true"><span class="ct-captain-body">'+portraitLayers+'</span><span class="ct-captain-caption" hidden></span></aside><div class="ct-map" role="status"></div></div>'
      + '<div class="ct-ledger"><div><span data-ct-label="balance"></span><div class="ct-balance-value"><strong data-ct-balance></strong><button type="button" class="ct-wallet" data-ct-action="wallet">+</button></div></div><div><span data-ct-label="cost"></span><strong data-ct-cost></strong></div><div><span data-ct-label="payout"></span><strong data-ct-payout></strong></div><div><span data-ct-label="net"></span><strong data-ct-net></strong></div></div>'
      + '<div class="ct-controls"><div class="ct-lines-control"><label for="ct-lines-input" data-ct-label="lines"></label><span class="ct-stepper"><button type="button" data-ct-action="lines-down">−</button><select id="ct-lines-input" data-ct-lines></select><button type="button" data-ct-action="lines-up">+</button></span></div><div class="ct-stake-control"><label for="ct-stake-input" data-ct-label="stake"></label><span class="ct-stepper"><button type="button" data-ct-action="stake-down">−</button><select id="ct-stake-input" data-ct-stake></select><button type="button" data-ct-action="stake-up">+</button></span></div><button type="button" data-ct-action="lines"></button><button type="button" data-ct-action="buy"></button><button type="button" class="ct-play" data-ct-action="play"><span class="ct-spin-icon" aria-hidden="true">↻</span><b></b><small></small></button></div>'
      + '<div class="ct-playback"><select data-ct-auto-count>'+AUTO_COUNTS.map(count=>'<option>'+count+'</option>').join('')+'</select><button type="button" data-ct-action="auto" aria-pressed="false"></button><button type="button" class="ct-skip" data-ct-action="skip" hidden></button></div>'
      + '<div class="ct-status" role="status" aria-live="polite"></div><div class="ct-choice" hidden></div><button type="button" class="ct-retry" data-ct-action="retry" hidden></button>'
      + '<div class="ct-backdrop" hidden><section class="ct-modal" role="dialog" aria-modal="true"></section></div>';
    host.replaceChildren(this.root);
    this.element('.ct-board-wrap').append(this.element('.ct-choice'));
    this.element('.ct-playback').append(this.element('[data-ct-action=retry]'));
    this.captain=new CaribbeanCaptain(this.root);this.visuals=new CaribbeanMotion(this.root,()=>this.reduced);
    this.root.querySelector('h2')!.textContent = this.title;
    this.element<HTMLSelectElement>('[data-ct-lines]').innerHTML = CARIBBEAN_LINE_COUNTS.map(lines => '<option>' + lines + '</option>').join('');
    this.element<HTMLSelectElement>('[data-ct-stake]').innerHTML = CARIBBEAN_LINE_STAKES.map(stake => '<option value="' + stake + '">' + this.money(stake) + '</option>').join('');
    this.dialog = new SlotDialog(this.element('.ct-modal'),this.element('.ct-backdrop'),'data-ct-modal',
      action => {
        if(action==='crew-tab'||action==='tasks-tab'){this.crewTab=action==='crew-tab'?'crew':'tasks';this.renderCrewDialog();this.dialog.focus();return;}
        if(action==='crew-refresh'){this.crewMessage='';void this.loadCrew();return;}
        if(action.startsWith('crew-')){void this.chooseCaptain(action.slice(5));return;}
        if(action.startsWith('unlock-')){void this.crewAction({id:crypto.randomUUID(),action:'unlock',characterId:action.slice(7)});return;}
        if(action.startsWith('answer:')){const [,challengeId,answer]=action.split(':');if(this.crewProfile)void this.crewAction({id:crypto.randomUUID(),action:'answer',challengeId,answer,day:this.crewProfile.day});return;}
        this.closeDialog(); if (action === 'buy-raid' || action === 'buy-flagship') void this.start(action);
      },
      () => this.closeDialog());
    this.root.addEventListener('click',event => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>('[data-ct-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.ctAction;
      if(action==='auto'){if(this.autoRunning)this.stopAuto('stopped');else this.startAuto();}
      else if (action === 'info' || action === 'history') this.openDialog(action);
      else if (action === 'crew') {if(!this.blocked){this.openDialog('crew');void this.loadCrew();}}
      else if (action === 'wallet') window.dispatchEvent(new Event('royal-open-wallet'));
      else if (action === 'skip') this.stopPresentation();
      else if (action === 'sound') { const p=this.services.gameAudio.getPreferences();this.services.gameAudio.setMuted(!p.muted);void this.audio.enter(); }
      else if (action === 'music') {this.audio.setMusic(!this.audio.musicEnabled());void this.audio.enter();this.render();}
      else if (action === 'lines') { this.showLines = !this.showLines; this.render(); }
      else if (action?.startsWith('lines-') || action?.startsWith('stake-')) {
        if(this.blocked || this.active || this.dialogKind || this.autoRunning)return;
        this.actionError='';
        const direction=action.endsWith('up')?1:-1;
        if(action.startsWith('lines-'))this.lines=CARIBBEAN_LINE_COUNTS[Math.max(0,Math.min(3,CARIBBEAN_LINE_COUNTS.indexOf(this.lines)+direction))];
        else this.lineStake=CARIBBEAN_LINE_STAKES[Math.max(0,Math.min(CARIBBEAN_LINE_STAKES.length-1,CARIBBEAN_LINE_STAKES.findIndex(stake=>stake===this.lineStake)+direction))];
        this.audio.cue('click');this.render();
      }
      else if (action === 'buy') { if (!this.blocked && !this.active) this.openDialog('buy'); }
      else if (action === 'play') {
        if(this.autoRunning)return;
        if (this.active) void this.move('caribbean-spin');
        else void this.start('normal');
      } else if (action === 'choose-raid' || action === 'choose-flagship') void this.move('caribbean-' + action);
      else if (action === 'retry') { if (!this.client.busy) void this.client.retry().catch(() => {}).finally(() => this.update()); }
    },{signal:this.lifetime.signal});
    this.root.addEventListener('change',event => {
      if (this.blocked || this.active || this.dialogKind || this.autoRunning) { this.render(); return; }
      const target = event.target;
      this.actionError='';
      if(target instanceof HTMLSelectElement&&target.matches('[data-ct-auto-count]')){
        const count=Number(target.value);if(AUTO_COUNTS.some(value=>value===count))this.autoCount=count;
      }else if (target instanceof HTMLSelectElement && target.matches('[data-ct-lines]')) {
        const lines = Number(target.value); if (validCaribbeanLineCount(lines)) this.lines = lines;
      } else if (target instanceof HTMLSelectElement && target.matches('[data-ct-stake]') && validCaribbeanStake(target.value)) this.lineStake = target.value;
      this.render();
    },{signal:this.lifetime.signal});
    this.root.addEventListener('keydown',event => {
      if (slotOwnsKeyboard(this.root,event)) this.dialog.keyboard(event,this.dialogKind);
    },{signal:this.lifetime.signal,capture:true});
    this.client.addEventListener('change',this.update,{signal:this.lifetime.signal});
    this.services.demoWallet.addEventListener('change',this.update,{signal:this.lifetime.signal});
    window.addEventListener('royal-account',this.update,{signal:this.lifetime.signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.stopAuto('paused');this.stopPresentation();}else this.render();},{signal:this.lifetime.signal});
    window.addEventListener('blur',()=>this.stopAuto('paused'),{signal:this.lifetime.signal});
    window.addEventListener('offline',()=>this.stopAuto('error'),{signal:this.lifetime.signal});
    this.motionPreference.addEventListener('change',()=>{if(this.reduced)this.stopPresentation();else this.render();},{signal:this.lifetime.signal});
    this.unsubscribeAudio=this.services.gameAudio.onPreferences(()=>this.render());
    this.update(); void this.client.refresh();
  }
  private element<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private update = () => {
    if (this.disposed) return;
    if (this.account !== this.client.accountId) {
      this.stopAuto('account',false);
      this.stopPresentation();this.captain.reset(true);this.account = this.client.accountId; this.sessionKey = ''; this.lines = 20; this.lineStake = '10';this.actionError='';this.lastBalance=undefined; this.closeDialog();
      this.crewAbort.abort();this.crewAbort=new AbortController();this.crewLoad++;this.crewProfile=undefined;this.crewMessage='';this.crewBusy=false;this.crewPendingCaptain=undefined;
      void this.captain.select(DEFAULT_CAPTAIN).then(()=>{if(!this.disposed)this.render();});
      void this.loadCrew();
    }
    if(this.wallet?.balance!==this.lastBalance){this.actionError='';this.lastBalance=this.wallet?.balance;}
    const session = this.session, view = this.view, key = session && view ? session.id + ':' + view.revision : '';
    if (view && key !== this.sessionKey) {
      this.lines = view.settings.lines; this.lineStake = view.version===1 && this.session?.state==='settled' ? String(BigInt(view.lineStakeUnits)*BigInt(view.settings.lines)) : view.lineStakeUnits; this.sessionKey = key;
    }
    if (this.dialogKind === 'buy' && this.blocked) this.closeDialog();
    this.render();
    this.pumpAuto();
  };
  private render() {
    if (this.disposed) return;
    const view = this.presenting ? this.displayed : this.view, frame = view?.spins.at(-1)?.frame;
    this.root.dataset.ctPhase=this.visualPhase;this.root.dataset.motion=this.reduced?'reduced':'full';
    this.root.dataset.outcome=view?.phase==='complete'?caribbeanOutcome(view):'';
    this.captain?.context(!this.paused&&!document.hidden&&!this.dialogKind,this.reduced,this.english);
    this.restoreCrewCaptain();
    const crewButton=this.element<HTMLButtonElement>('[data-ct-action=crew]'),member=crewMember(this.captain.state().character)!;
    crewButton.disabled=this.blocked||this.autoRunning;
    crewButton.setAttribute('aria-label',this.text('Выбрать пиратку. Сейчас: ','Choose a pirate. Current: ')+(this.english?member.en:member.ru));
    crewButton.title=this.text('Выбрать пиратку','Choose a pirate');
    this.root.setAttribute('aria-busy',String(this.presenting||this.client.busy));
    const sound=this.element<HTMLButtonElement>('[data-ct-action=sound]'),music=this.element<HTMLButtonElement>('[data-ct-action=music]');
    const muted=this.services.gameAudio.getPreferences().muted;sound.setAttribute('aria-label',this.text(muted?'Включить звук':'Выключить звук',muted?'Enable sound':'Mute sound'));sound.setAttribute('aria-pressed',String(!muted));
    music.setAttribute('aria-label',this.text(this.audio.musicEnabled()?'Выключить музыку':'Включить музыку',this.audio.musicEnabled()?'Mute music':'Enable music'));music.setAttribute('aria-pressed',String(this.audio.musicEnabled()));
    const waiting=this.element('.ct-waiting');waiting.hidden=this.visualPhase!=='waiting';waiting.textContent=this.text('Подтверждаем ход...','Confirming operation...');
    const skip=this.element('[data-ct-action=skip]');skip.hidden=!this.presenting||this.visualPhase==='waiting';skip.textContent=this.text('Показать итог сразу','Show final result');
    const lines = this.element<HTMLSelectElement>('[data-ct-lines]'), stake = this.element<HTMLSelectElement>('[data-ct-stake]');
    lines.value = String(this.lines); stake.value = this.lineStake;
    lines.disabled = stake.disabled = this.blocked || !!this.active || !!this.dialogKind || this.autoRunning;
    for(const kind of ['lines','stake'])for(const direction of ['down','up']){
      const button=this.element<HTMLButtonElement>('[data-ct-action='+kind+'-'+direction+']');
      const index=kind==='lines'?CARIBBEAN_LINE_COUNTS.indexOf(this.lines):CARIBBEAN_LINE_STAKES.findIndex(stake=>stake===this.lineStake);
      button.disabled=lines.disabled || (direction==='down'?index===0:index===(kind==='lines'?CARIBBEAN_LINE_COUNTS.length-1:CARIBBEAN_LINE_STAKES.length-1));
      button.setAttribute('aria-label',this.text(direction==='down'?'Уменьшить ':'Увеличить ',direction==='down'?'Decrease ':'Increase ')+this.text(kind==='lines'?'число линий':'ставку на линию',kind==='lines'?'lines':'total stake'));
    }
    for (const [key,label] of Object.entries({
      balance:this.text('Баланс · USDT','Balance · USDT'),
      cost:this.active ? this.text('Цена принятого раунда','Accepted round cost') : this.text('Ставка за вращение','Spin cost'),payout:this.active ? this.text('Накоплено в раунде','Round total') : this.text('Выплата раунда','Round payout'),
      net:this.text('Чистый итог раунда','Net round result'),lines:this.text('Линии','Lines'),stake:this.text('Общая ставка · USDT','Total stake · USDT'),
    })) this.element('[data-ct-label="' + key + '"]').textContent = label;
    this.element('[data-ct-balance]').textContent = this.wallet ? this.services.walletCoins(this.wallet.balance) : '...';
    const walletButton=this.element<HTMLButtonElement>('[data-ct-action=wallet]');walletButton.disabled=!this.client.accountId;
    walletButton.setAttribute('aria-label',this.text('Открыть тестовый кошелёк','Open test wallet'));
    this.element('[data-ct-cost]').textContent = this.view && this.active ? this.money(this.view.costUnits) : this.money(caribbeanInitialCost({lines:this.lines,mode:'normal',stakeBasis:'total'},this.lineStake));
    this.element('[data-ct-payout]').textContent = this.money(this.tally ?? view?.totalPayoutUnits ?? '0');
    const net = view && !this.active ? BigInt(view.totalPayoutUnits) - BigInt(view.costUnits) : null;
    this.element('[data-ct-net]').textContent = net === null ? (this.active ? this.text('Серия идёт','Round in progress') : '...') : (net > 0n ? '+' : '') + this.money(String(net));
    this.element('[data-ct-net]').dataset.positive = String(net !== null && net > 0n);
    this.element<HTMLButtonElement>('[data-ct-action=info]').setAttribute('aria-label',this.text('Правила и выплаты','Rules and payouts'));
    this.element<HTMLButtonElement>('[data-ct-action=history]').setAttribute('aria-label',this.text('История раунда','Round history'));
    this.element('[data-ct-action=lines]').textContent = this.text('Показать линии','Show lines');
    this.element('[data-ct-action=lines]').setAttribute('aria-pressed',String(this.showLines));
    const buy = this.element<HTMLButtonElement>('[data-ct-action=buy]');
    buy.textContent = this.text('Купить бонус','Buy bonus'); buy.disabled = this.blocked || !!this.active || !!this.dialogKind || this.autoRunning || !this.canAfford('buy-raid');
    const play = this.element<HTMLButtonElement>('[data-ct-action=play]');
    play.querySelector('b')!.textContent = view?.phase === 'choice' ? this.text('Тактика','Tactic') : this.active ? this.text('Бесплатно','Free spin') : this.text('Вращать','Spin');
    play.querySelector('small')!.textContent=view?.phase === 'choice' ? this.text('Выбери ниже','Choose below') : this.active ? this.text('Осталось ','Remaining ') + (view?.remaining ?? 0) : this.money(caribbeanInitialCost({lines:this.lines,mode:'normal',stakeBasis:'total'},this.lineStake))+' USDT';
    play.disabled = this.blocked || !!this.dialogKind || this.autoRunning || view?.phase === 'choice' || !this.active&&!this.canAfford('normal');
    const auto=this.element<HTMLButtonElement>('[data-ct-action=auto]'),count=this.element<HTMLSelectElement>('[data-ct-auto-count]');
    auto.textContent=this.autoRunning?this.text('Стоп · ','Stop · ')+this.autoRemaining:this.text('Авто','Auto');
    auto.setAttribute('aria-pressed',String(this.autoRunning));
    auto.setAttribute('aria-label',this.autoRunning?this.text('Остановить автокрутку','Stop autoplay'):this.text('Начать автокрутку','Start autoplay'));
    auto.disabled=!this.autoRunning&&(this.blocked||!!this.active||!!this.dialogKind||!!this.client.error||!!this.actionError||!this.canAfford('normal'));
    count.value=String(this.autoCount);count.disabled=this.autoRunning||this.blocked||!!this.active||!!this.dialogKind;
    count.setAttribute('aria-label',this.text('Количество автовращений','Autoplay spin count'));
    this.element('.ct-playback').setAttribute('aria-label',this.text('Автокрутка и показ результата','Autoplay and result playback'));
    const retry = this.element<HTMLButtonElement>('[data-ct-action=retry]');
    retry.hidden = !this.client.pending; retry.disabled = this.client.busy;
    retry.textContent = this.text('Проверить тот же ход','Check the same operation');
    this.element('.ct-status').textContent = this.client.error || this.actionError || (!this.client.accountId ? this.text('Войди в зал, чтобы играть.','Sign in to play.')
      : this.client.busy ? this.text('Подтверждаем ход...','Confirming...')
      : this.services.demoWallet.pending ? this.text('Проверь предыдущую операцию общего кошелька.','Check the previous shared wallet operation.')
      : this.presenting && this.visualPhase!=='outcome' ? this.text('Показываем подтверждённый результат...','Revealing the confirmed result...')
      : !this.active && this.wallet && !this.canAfford('normal') ? this.text('Недостаточно средств: нужно ','Not enough funds: need ')+this.money(caribbeanInitialCost({lines:this.lines,mode:'normal',stakeBasis:'total'},this.lineStake))+' USDT. '+this.text('Уменьши ставку или открой кошелёк кнопкой + у баланса.','Lower your stake or open the wallet with + beside the balance.')
      : this.autoRunning ? (view?.phase==='choice'?this.text('Выбери тактику. Автокрутка ждёт.','Choose your tactic. Autoplay is waiting.'):this.text('Автокрутка: осталось раундов ','Autoplay: rounds remaining ')+this.autoRemaining)
      : this.autoNote ? this.autoLabel()
      : view?.phase==='complete' ? this.outcomeLabel(view)
      : this.active ? this.text('Продолжение бесплатно. Выплата начисляется в конце раунда.','Free continuation. The complete round is credited at the end.')
      : this.text('Гигантский символ занимает несколько клеток. Выплаты считаются по активным линиям.','A giant symbol fills several cells. Active lines determine the payouts.'));
    const choice = this.element('.ct-choice');
    choice.hidden = view?.phase !== 'choice';
    choice.innerHTML = view?.phase === 'choice' ? '<strong>' + this.text('Карта абордажа открыта. Выбери тактику.','Boarding map unlocked. Choose your tactic.') + '</strong>'
      + '<button type="button" data-ct-action="choose-raid"' + (this.blocked ? ' disabled' : '') + '>' + this.text('Рейд · 14 вращений','Raid · 14 spins') + '</button>'
      + '<button type="button" data-ct-action="choose-flagship"' + (this.blocked ? ' disabled' : '') + '>' + this.text('Флагман · 6 вращений','Flagship · 6 spins') + '</button>' : '';
    this.element('.ct-map').textContent = view?.phase === 'choice' ? this.text('КАРТА АБОРДАЖА · 3 / 3','BOARDING MAP · 3 / 3')
      : this.active ? (view?.tactic === 'raid' ? this.text('РЕЙД','RAID') : this.text('ФЛАГМАН','FLAGSHIP'))
      : this.text('КАРИБСКИЕ СОКРОВИЩА','CARIBBEAN TREASURES');
    const grid = frame?.grid ?? Array.from({length:24},(_,index) => (index % 6+Math.floor(index/6)*2) % 6), block = frame?.block;
    const paid = new Set(frame?.wins.flatMap(win => win.positions) ?? []);
    const board = this.element('.ct-board'); board.setAttribute('aria-label',this.text('Поле 6 барабанов, 4 ряда','6 reel, 4 row field'));
    const signature=JSON.stringify([grid,block,frame?.cannon,[...paid],this.showLines,this.lines,this.english]);
    const updateStops=()=>{board.querySelectorAll('.ct-cell').forEach((cell,index)=>cell.classList.toggle('ct-landed',index%6<this.stopped));board.querySelectorAll<HTMLElement>('.ct-strip').forEach((strip,index)=>strip.hidden=!(this.visualPhase==='waiting'||(this.visualPhase==='reels'&&index>=this.stopped)));};
    if(signature===this.boardSignature){updateStops();return;}
    this.boardSignature=signature;
    if(!board.querySelector('.ct-cell'))board.innerHTML=Array.from({length:24},(_,index)=>'<div class="ct-cell" data-ct-cell="'+index+'"></div>').join('')+'<div class="ct-strips" aria-hidden="true">'+Array.from({length:6},(_,column)=>'<div class="ct-strip" style="grid-column:'+(column+1)+';grid-row:1" hidden><div class="ct-strip-track" style="animation-delay:-'+column*.07+'s">'+Array.from({length:12},(_,row)=>caribbeanIcon((column+row%4*2)%6)).join('')+'</div></div>').join('')+'</div><div class="ct-giant" hidden></div><svg class="ct-paths" viewBox="0 0 600 400" aria-hidden="true"></svg><div class="ct-cannon-smoke" aria-hidden="true"></div>';
    board.querySelectorAll<HTMLElement>('.ct-cell').forEach((cell,index)=>{
      const symbol=grid[index],inside=!!block&&index%6>=block.x&&index%6<block.x+block.size&&Math.floor(index/6)>=block.y&&Math.floor(index/6)<block.y+block.size;
      cell.classList.toggle('ct-covered',inside);cell.classList.toggle('ct-landed',index%6<this.stopped);cell.dataset.symbol=String(symbol);cell.setAttribute('aria-label',this.symbolName(symbol));
      const art=symbol+':'+this.english;
      if(!inside&&cell.dataset.art!==art){cell.innerHTML=caribbeanIcon(symbol)+'<span>'+escape(this.symbolName(symbol))+'</span>';cell.dataset.art=art;}
    });
    const insideBlock=(position:number)=>!!block&&position%6>=block.x&&position%6<block.x+block.size&&Math.floor(position/6)>=block.y&&Math.floor(position/6)<block.y+block.size;
    const giant=board.querySelector<HTMLElement>('.ct-giant')!;giant.hidden=!block;giant.classList.toggle('ct-paid',[...paid].some(insideBlock));
    if(block){
      if(giant.dataset.symbol!==String(block.symbol)||giant.dataset.language!==String(this.english)){giant.innerHTML=caribbeanIcon(block.symbol)+'<strong></strong><small></small>';giant.dataset.language=String(this.english);}
      giant.dataset.symbol=String(block.symbol);giant.dataset.ctBlock=String(block.size);
      giant.style.cssText=`left:${block.x/6*100}%;top:${block.y/4*100}%;width:${block.size/6*100}%;height:${block.size/4*100}%`;
      giant.querySelector('strong')!.textContent=this.symbolName(block.symbol);giant.querySelector('small')!.textContent=block.size+'×'+block.size+(frame?.cannon?this.text(' · ЗАЛП',' · CANNON'):'');
    }
    const paths=board.querySelector<SVGElement>('.ct-paths')!,pathKey=JSON.stringify([[...paid],block,this.showLines,this.lines,frame?.wins[0]?.line]);
    if(paths.dataset.paths!==pathKey){paths.dataset.paths=pathKey;paths.innerHTML=[...paid].filter(position=>!insideBlock(position)).map(position=>'<rect x="'+(position%6*100+4)+'" y="'+(Math.floor(position/6)*100+4)+'" width="92" height="92" rx="6"/>').join('')
      +(this.showLines?CARIBBEAN_LINES.slice(0,this.lines).map(line=>'<polyline points="'+line.map((row,column)=>(column*100+50)+','+(row*100+50)).join(' ')+'"/>').join(''):'')
      +(frame?.wins.length?'<defs><mask id="ct-paid-route"><rect width="600" height="400" fill="white"/>'+(block?'<rect x="'+block.x*100+'" y="'+block.y*100+'" width="'+block.size*100+'" height="'+block.size*100+'" fill="black"/>':'')+'</mask></defs><path class="ct-win-route" mask="url(#ct-paid-route)" pathLength="1" d="M '+frame.wins[0].positions.map(position=>(position%6*100+50)+','+(Math.floor(position/6)*100+50)).join(' L ')+'"/>':'');}
    updateStops();
  }
  private async start(mode: CaribbeanStartMode) {
    if (this.disposed || this.blocked || this.active || this.dialogKind) return;
    if(!this.canAfford(mode)){this.actionError=this.text('Недостаточно средств: нужно ','Not enough funds: need ')+this.money(caribbeanInitialCost({lines:this.lines,mode,stakeBasis:'total'},this.lineStake))+' USDT.';this.render();return;}
    this.actionError='';
    if(!this.autoRunning)this.autoNote='';
    const settings: CaribbeanSettings = {lines:this.lines,mode,stakeBasis:'total'};
    const before=this.session?.id;
    try { await this.perform(()=>this.client.act({gameId:CARIBBEAN_GAME,action:'start',stakeUnits:this.lineStake,settings:{caribbean:settings}})); }
    catch(error) {this.actionError=this.client.pending?'':error instanceof Error?error.message:this.client.error;}
    finally { this.update(); }
    return !!this.session&&this.session.id!==before;
  }
  private autoLabel(){
    return this.text({complete:'Автокрутка завершена.',stopped:'Автокрутка остановлена.',funds:'Авто остановлено: недостаточно средств.',error:'Авто остановлено: проверь ход перед продолжением.',paused:'Авто остановлено при паузе.',account:'Авто остановлено при смене аккаунта.','':''}[this.autoNote],
      {complete:'Autoplay complete.',stopped:'Autoplay stopped.',funds:'Autoplay stopped: insufficient balance.',error:'Autoplay stopped: check the move before continuing.',paused:'Autoplay stopped on pause.',account:'Autoplay stopped on account change.','':''}[this.autoNote]);
  }
  private stopAuto(note:AutoNote,notify=true){
    clearTimeout(this.autoTimer);this.autoTimer=undefined;this.autoEpoch++;
    const running=this.autoRunning;this.autoRunning=false;this.autoRemaining=0;this.autoInFlight=false;
    if(running)this.autoNote=note;
    if(running&&notify&&!this.disposed)this.render();
  }
  private startAuto(){
    if(this.disposed||this.blocked||this.active||this.dialogKind||this.client.error||this.actionError||this.autoRunning||document.hidden||!this.canAfford('normal'))return;
    this.autoRunning=true;this.autoRemaining=this.autoCount;this.autoNote='';this.autoEpoch++;this.render();this.pumpAuto();
  }
  private pumpAuto(){
    if(!this.autoRunning||this.disposed)return;
    if(this.paused||document.hidden){this.stopAuto('paused');return;}
    if(!this.client.accountId||this.account!==this.client.accountId){this.stopAuto('account');return;}
    if(this.autoInFlight)return;
    if(this.client.pending||this.client.error||this.actionError||this.services.demoWallet.pending){this.stopAuto('error');return;}
    if(this.blocked||this.dialogKind)return;
    if(this.active&&this.view?.phase==='choice')return;
    if(!this.active){
      if(this.autoRemaining===0){this.stopAuto('complete');return;}
      if(!this.canAfford('normal')){this.stopAuto('funds');return;}
    }
    if(this.autoTimer)return;
    const epoch=this.autoEpoch;
    this.autoTimer=setTimeout(()=>{this.autoTimer=undefined;void this.nextAuto(epoch).catch(()=>{if(epoch===this.autoEpoch&&!this.disposed)this.stopAuto('error');});},600);
  }
  private async nextAuto(epoch:number){
    if(epoch!==this.autoEpoch||!this.autoRunning||this.disposed)return;
    if(this.blocked||this.dialogKind||document.hidden||this.client.error||this.actionError){this.pumpAuto();return;}
    const continuation=!!this.active;
    if(continuation&&this.view?.phase!=='bonus'){this.pumpAuto();return;}
    if(!continuation&&!this.canAfford('normal')){this.stopAuto('funds');return;}
    this.autoInFlight=true;
    if(continuation){
      const before=this.view?.revision;await this.move('caribbean-spin');
      if(epoch!==this.autoEpoch||!this.autoRunning||this.disposed)return;
      if(this.view?.revision===before){this.autoInFlight=false;this.stopAuto('error');return;}
    }
    else{
      const accepted=await this.start('normal');
      if(epoch!==this.autoEpoch||!this.autoRunning||this.disposed)return;
      if(!accepted){this.autoInFlight=false;this.stopAuto('error');return;}
      this.autoRemaining--;
    }
    if(epoch!==this.autoEpoch||!this.autoRunning||this.disposed)return;
    this.autoInFlight=false;this.render();this.pumpAuto();
  }
  private async move(move: string) {
    const session = this.session, view = this.view;
    if (this.disposed || this.blocked || !session || !view || session.state !== 'active' || this.dialogKind) return;
    if (!session.view.actions.some(action => action.move === move && action.cost === 0)) return;
    const manualAutoChoice=this.autoRunning&&!this.autoInFlight,epoch=this.autoEpoch;
    if(manualAutoChoice)this.autoInFlight=true;
    this.actionError='';
    try { await this.perform(()=>this.client.act({gameId:CARIBBEAN_GAME,action:'move',sessionId:session.id,move,revision:view.revision})); }
    catch(error) {this.actionError=this.client.pending?'':error instanceof Error?error.message:this.client.error;}
    finally {if(manualAutoChoice&&epoch===this.autoEpoch)this.autoInFlight=false;this.update();}
  }
  private outcomeLabel(view:CaribbeanView){
    const kind=caribbeanOutcome(view);
    return this.text({loss:'Раунд завершён без выплаты.',partial:'Частичный возврат. Выплата меньше стоимости раунда.',return:'Стоимость раунда возвращена.',win:'Положительный итог раунда.',bigwin:'Крупный положительный итог раунда.'}[kind],
      {loss:'Round complete without a payout.',partial:'Partial return. The payout is below the round cost.',return:'The round cost has been returned.',win:'Positive round result.',bigwin:'Large positive round result.'}[kind]);
  }
  private stopPresentation(){
    this.visuals?.cancel();this.captain?.reset();
    this.motion.abort();this.tally=undefined;this.presenting=false;this.displayed=undefined;this.visualPhase='idle';this.stopped=6;this.audio.pause();
    if(this.root&&!this.disposed)this.render();
  }
  private wait(ms:number,signal:AbortSignal){return new Promise<void>(resolve=>{
    if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,Math.max(0,ms));signal.addEventListener('abort',done,{once:true});
  });}
  private async accent(cue:CaribbeanCue,signal:AbortSignal,visual:()=>void,variant=0){
    if(signal.aborted||document.hidden||this.paused)return;
    const preparing=performance.now(),expected=this.audio.cue(cue,variant),preparationMs=performance.now()-preparing;
    // Reserve a frame for painting instead of requesting the next frame after audio is audible.
    await this.wait(expected-performance.now()-24,signal);if(signal.aborted)return;
    await new Promise<void>(resolve=>{
      const done=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',done);resolve();};
      const frame=requestAnimationFrame(()=>{if(!signal.aborted){const painting=performance.now();visual();this.captain.react(cue,this.sessionKey+':'+cue+':'+variant,variant);if(cue==='stop')this.visuals.land(variant);else if(cue==='giant')this.visuals.giant();else if(cue==='win'||cue==='bigwin')this.visuals.outcome(cue==='bigwin');this.accents.push({cue,deviationMs:performance.now()-expected,preparationMs,visualMs:performance.now()-painting});if(this.accents.length>80)this.accents.shift();}done();});
      signal.addEventListener('abort',done,{once:true});
    });
  }
  private async perform(action:()=>Promise<unknown>){
    const previous=this.view,priorKey=this.sessionKey,account=this.client.accountId;
    this.motion.abort();const motion=this.motion=new AbortController(),signal=motion.signal;
    this.visuals.cancel();this.captain.begin();
    this.displayed=previous;this.presenting=true;this.visualPhase='waiting';this.render();void this.audio.enter();
    try{
      await action();
      if(signal.aborted||this.disposed||account!==this.client.accountId||document.hidden||this.paused)return;
      const confirmed=this.view;if(!confirmed||this.sessionKey===priorKey)return;
      const previousInRound=this.session?.id===priorKey.split(':')[0]?previous:undefined;
      const hasSpin=confirmed.spins.length>(previousInRound?.spins.length??0);
      if(this.reduced){this.displayed=confirmed;this.visualPhase='outcome';this.render();const cue=confirmed.phase==='complete'?caribbeanOutcome(confirmed):confirmed.phase==='choice'||!hasSpin?'bonus':'click';this.audio.cue(cue);this.captain.react(cue,this.sessionKey+':'+cue+':0');return;}
      if(hasSpin){
        this.displayed=caribbeanBeforeReveal(confirmed,previousInRound);this.stopped=0;this.visualPhase='reels';
        // The continuous giant is revealed only after every underlying column lands.
        const beforeBlock=this.displayed.spins.at(-1)?.frame.block;
        this.displayed.spins.at(-1)!.frame.block=null;this.render();
        for(let column=0;column<6&&!signal.aborted;column++){
          await this.wait(100,signal);await this.accent('stop',signal,()=>{this.stopped=column+1;this.render();},column);
        }
        if(signal.aborted)return;
        await this.wait(140,signal);if(signal.aborted)return;
        if(beforeBlock){this.displayed.spins.at(-1)!.frame.block=beforeBlock;this.visualPhase='giant';await this.accent('giant',signal,()=>this.render());await this.wait(340,signal);}
        if(signal.aborted)return;
        if(confirmed.spins.at(-1)?.frame.cannon){this.visualPhase='cannon';await this.accent('cannon',signal,()=>{
          const old=this.root.querySelector('.ct-giant')?.getBoundingClientRect();
          this.displayed=structuredClone(confirmed);this.displayed.totalPayoutUnits=previousInRound?.totalPayoutUnits??'0';this.displayed.spins.at(-1)!.frame.wins=[];this.render();
          this.visuals.cannon(old);
        });await this.wait(380,signal);}
        if(signal.aborted)return;
        this.displayed=confirmed;this.visualPhase='wins';
        this.tally=previousInRound?.totalPayoutUnits??'0';
        if(confirmed.spins.at(-1)?.frame.wins.length)await this.accent('line',signal,()=>this.render());else this.render();
        await this.visuals.tally(this.tally,confirmed.totalPayoutUnits,420,signal,units=>{this.tally=units;this.element('[data-ct-payout]').textContent=this.money(units);});
        this.tally=undefined;
      }
      if(signal.aborted)return;
      this.displayed=confirmed;this.visualPhase='outcome';
      if(confirmed.phase==='complete')await this.accent(caribbeanOutcome(confirmed),signal,()=>this.render());
      else if(confirmed.phase==='choice'||!hasSpin)await this.accent('bonus',signal,()=>this.render());
      else this.render();
      await this.wait(confirmed.phase==='complete'&&caribbeanOutcome(confirmed)==='bigwin'?700:180,signal);
    }finally{
      if(this.motion===motion&&!this.disposed){this.tally=undefined;this.presenting=false;this.displayed=undefined;this.visualPhase='idle';this.stopped=6;this.captain.finish();this.render();}
    }
  }
  pause(){this.paused=true;this.stopAuto('paused');this.stopPresentation();}
  resume(){this.paused=false;this.render();}
  private openDialog(kind: 'info' | 'history' | 'buy' | 'crew') {
    if (this.disposed) return;
    this.stopAuto('stopped',false);
    if(this.presenting)this.stopPresentation();
    this.crewDialog=kind==='crew';this.dialogKind = kind==='crew'?'info':kind;
    const panel = this.element('.ct-modal'), view = this.view;
    panel.classList.toggle('ct-crew-modal',this.crewDialog);
    let body: string;
    if(kind==='crew'){
      this.crewMessage='';this.crewSuccess=false;
      body=this.crewBody();
    }else if (kind === 'info') {
      body = '<h3>' + this.text('Правила и выплаты','Rules and payouts') + '</h3><p>' + this.text('6 барабанов, 4 ряда. От 3 одинаковых подряд слева направо. На одной линии оплачивается самая длинная цепочка.','6 reels, 4 rows. Match 3 or more identical symbols from the left. Only the longest run pays on each line.') + '</p>'
        + '<table><thead><tr><th>' + this.text('Символ','Symbol') + '</th><th>3</th><th>4</th><th>5</th><th>6</th></tr></thead><tbody>' + CARIBBEAN_SYMBOLS.map(symbol => '<tr><th>' + this.symbolName(symbol.id) + '</th>' + symbol.pays.map(pay => '<td>×' + pay + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
        + '<p>' + this.text('Коэффициенты относятся к ставке одной линии. Блок 2×2 может увеличиться залпом до 3×3. Расчёт выполняется по итоговому полю.','Multipliers use the stake per line. A cannon can grow a 2×2 block into 3×3. The final field determines payouts.') + '</p>'
        + '<p>' + this.text('Рейд: 14 вращений с блоком 2×2 и возможным залпом. Флагман: 6 вращений с блоком 3×3. Продления нет. Выплата всей серии начисляется в конце.','Raid: 14 spins with a 2×2 block and possible cannon. Flagship: 6 spins with a 3×3 block. No retriggers. The entire round is credited at the end.') + '</p>'
        + '<p>' + this.text('Бонусная карта открывается отдельным случайным событием после обычного вращения. Картинки карты в поле являются обычными оплачиваемыми символами. Выбирается первый набор из 1, 5, 10 или 20 фиксированных линий; отдельные маршруты не переключаются.','A separate random event after a base spin unlocks the bonus map. Map icons on the field are ordinary paying symbols. Select the first 1, 5, 10 or 20 fixed lines; individual routes cannot be switched.') + '</p>'
        + '<p>' + this.text('Теоретический RTP около 96%. Частота блоков и входа в бонус зависит от набора линий. RTP относится к полной игре на длинной дистанции.','Theoretical RTP is approximately 96%. Block and bonus entry probabilities depend on the line preset. RTP describes complete rounds over the long term.') + '</p>'
        + '<p>' + this.text('Автокрутка запускает 10, 25, 50 или 100 обычных платных раундов по текущим линиям и ставке. Тактику бонуса выбираешь сам; бесплатные продолжения выполняются автоматически и не расходуют счётчик. Покупок бонуса в авто нет. «Стоп» отменяет следующие ходы, сохраняя уже принятый. Ошибка, неизвестный ответ, нехватка средств, пауза, смена аккаунта или закрытие останавливают авто. Самостоятельного возобновления нет.','Autoplay starts 10, 25, 50 or 100 normal paid rounds at the current lines and stake. Choose your bonus tactic yourself; free continuations run automatically without using the counter. Auto never buys a bonus. Stop cancels future moves and preserves accepted operations. An error, unknown response, insufficient funds, pause, account change or closing stops auto. It never resumes on its own.') + '</p>';
    } else if (kind === 'history') {
      body = '<h3>' + this.text('История текущего раунда','Current round history') + '</h3>' + (view ?
        '<p>' + this.text('Линий: ','Lines: ') + view.settings.lines + ' · ' + (view.version===2?this.text('Общая ставка: ','Total stake: '):this.text('На линию: ','Per line: ')) + this.money(view.lineStakeUnits) + ' USDT</p>'
          + (view.tactic ? '<p>' + (view.tactic === 'raid' ? this.text('Рейд · 14 вращений','Raid · 14 spins') : this.text('Флагман · 6 вращений','Flagship · 6 spins')) + '</p>' : '')
          + '<p>' + this.text('Стоимость: ','Cost: ') + this.money(view.costUnits) + ' USDT</p><ol>' + view.spins.map((spin,index) => '<li>' + (index + 1) + '. '
          + (spin.frame.mode === 'base' ? this.text('Обычное вращение','Base spin') : this.text('Бесплатное вращение','Free spin'))
          + ' · ' + this.money(spin.payoutUnits) + ' USDT' + (spin.frame.cannon ? this.text(' · Залп',' · Cannon') : '') + '</li>').join('') + '</ol>'
          + '<p>' + this.text('Выплата раунда: ','Round payout: ') + this.money(view.totalPayoutUnits) + ' USDT</p>' : '<p>' + this.text('Вращений пока нет.','No spins yet.') + '</p>');
    } else {
      const cost = this.money(caribbeanInitialCost({lines:this.lines,mode:'buy-raid',stakeBasis:'total'},this.lineStake));
      body = '<h3>' + this.text('Купить бесплатную серию','Buy a free spin series') + '</h3><p>' + this.text('Линий: ','Lines: ') + this.lines + ' · ' + this.text('Общая ставка: ','Total stake: ') + this.money(this.lineStake) + ' USDT</p><p class="ct-buy-price">' + cost + ' USDT</p><p>' + this.text('Одна покупка. Продолжения бесплатны. Выбери серию:','One purchase. Continuations are free. Choose a series:') + '</p>'
        + '<button type="button" data-ct-modal="buy-raid">' + this.text('Рейд · 14 вращений','Raid · 14 spins') + '</button>'
        + '<button type="button" data-ct-modal="buy-flagship">' + this.text('Флагман · 6 вращений','Flagship · 6 spins') + '</button>';
    }
    if(kind==='info')body+='<p class="ct-audio-credits">'+this.text('Музыка: ','Music: ')+'<a href="https://opengameart.org/content/blackmoor-tides-epic-pirate-battle-theme" target="_blank" rel="noopener noreferrer">Blackmoor Tides</a> · <a href="https://www.matthewpablo.com" target="_blank" rel="noopener noreferrer">Matthew Pablo</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">CC BY 3.0</a>. '+this.text('Инструментальная петля, нормализация и короткие затухания. Звуковые эффекты: Kenney и Thimras, CC0.','Instrumental loop, normalization and short fades. Sound effects: Kenney and Thimras, CC0.')+'</p>';
    panel.innerHTML = body + '<button type="button" class="ct-modal-close" data-ct-modal="close">' + this.text('Закрыть','Close') + '</button>';
    panel.setAttribute('aria-label',this.crewDialog?this.text('Выбор пиратки','Pirate selection'):this.text('Информация об игре','Game information'));
    this.dialog.begin(this.dialogKind); this.render(); this.dialog.focus();
  }
  private crewError(error:unknown){
    const code=error instanceof Error?error.message:'';return crewErrors[code]?.[this.english?1:0]??this.text('Не удалось подтвердить изменение коллекции. Обнови её состояние.','The collection change could not be confirmed. Refresh its status.');
  }
  private crewBody(){
    const profile=this.crewProfile,busy=this.crewBusy||this.choosingCaptain,word=(v:{ru:string;en:string})=>escape(this.english?v.en:v.ru);
    let body='<div class="ct-crew-heading"><h3>'+this.text('Собрать команду','Gather the crew')+'</h3><button type="button" class="ct-crew-refresh" data-ct-modal="crew-refresh" aria-label="'+this.text('Обновить коллекцию','Refresh collection')+'"'+(busy||this.crewLoading?' disabled':'')+'>↻</button><button type="button" class="ct-crew-close" data-ct-modal="close" aria-label="'+this.text('Закрыть выбор пиратки','Close pirate selection')+'">×</button></div>';
    body+='<div class="ct-crew-summary"><strong data-ct-crew-tokens>'+this.text('Жетоны команды: ','Crew tokens: ')+(profile?.tokens??'...')+'</strong><span>'+this.text('Открытие героини: 100 жетонов','Unlock a captain: 100 tokens')+'</span></div><p class="ct-crew-note">'+this.text('Жетоны дают бесплатные задания. Их можно потратить на открытие любой пиратки.','Free challenges award tokens. Spend them to unlock any pirate.')+'</p>';
    body+='<div class="ct-crew-tabs"><button type="button" data-ct-modal="crew-tab" aria-pressed="'+String(this.crewTab==='crew')+'">'+this.text('Команда','Crew')+'</button><button type="button" data-ct-modal="tasks-tab" aria-pressed="'+String(this.crewTab==='tasks')+'">'+this.text('Бесплатные задания','Free challenges')+'</button></div>';
    if(!profile)body+='<p>'+this.text(this.crewLoading?'Загружаем коллекцию...':'Коллекция пока недоступна.',this.crewLoading?'Loading collection...':'The collection is unavailable right now.')+'</p>';
    else if(this.crewTab==='crew')body+='<div class="ct-crew-grid">'+CARIBBEAN_CREW.map(member=>{
      const owned=profile.owned.includes(member.id),selected=profile.selected===member.id,canUnlock=profile.tokens>=profile.unlockCost;
      const action=owned?'crew-'+member.id:canUnlock?'unlock-'+member.id:'tasks-tab';
      const label=owned?this.text(selected?'Выбрана':'Выбрать',selected?'Selected':'Select'):this.text(canUnlock?'Открыть · 100':'Жетоны: '+profile.tokens+' / 100',canUnlock?'Unlock · 100':'Tokens: '+profile.tokens+' / 100');
      return '<button type="button" class="ct-crew-card'+(this.crewNewlyUnlocked===member.id?' ct-crew-unlocked':'')+'" data-crew-id="'+member.id+'" data-owned="'+String(owned)+'" data-ct-modal="'+action+'" aria-pressed="'+String(selected)+'"'+(busy?' disabled':'')+' style="--crew-accent:'+member.accent+'"><span class="ct-crew-image"><img src="'+crewThumbnail(member.id)+'" alt="" loading="lazy" decoding="async"></span><strong>'+escape(this.english?member.en:member.ru)+'</strong><small>'+escape(this.english?member.titleEn:member.titleRu)+'</small><span class="ct-crew-selected">'+this.text(owned?'Открыта':'Закрыта',owned?'Unlocked':'Locked')+'</span><span class="ct-crew-card-action">'+label+'</span>'+(!owned?'<progress max="100" value="'+Math.min(profile.tokens,100)+'" aria-label="'+this.text('Прогресс открытия','Unlock progress')+'"></progress>':'')+'</button>';
    }).join('')+'</div>';
    else{
      body+='<p class="ct-crew-note">'+this.text('Учебные задания выполняются один раз. Два задания дня обновляются в 00:00 по Москве. Все задания бесплатны, вращения не требуются.','Lessons can be completed once. Two daily challenges reset at midnight Moscow time. All challenges are free and require no spins.')+'</p><div class="ct-crew-challenges">';
      for(const challenge of profile.challenges){
        body+='<section class="ct-crew-challenge" tabindex="-1" data-challenge-id="'+escape(challenge.id)+'" data-completed="'+String(challenge.completed)+'"><h4>'+word(challenge.title)+' <small>+'+challenge.reward+' '+this.text('жетонов','tokens')+'</small></h4>';
        if(challenge.completed)body+='<p class="ct-crew-done">'+this.text('Выполнено, награда получена','Complete, reward received')+'</p>';
        else body+='<p>'+word(challenge.question)+'</p><div class="ct-crew-answers">'+challenge.options.map(option=>'<button type="button" data-ct-modal="answer:'+escape(challenge.id)+':'+escape(option.id)+'"'+(busy?' disabled':'')+'>'+word(option.text)+'</button>').join('')+'</div>';
        if(this.crewFeedback===challenge.id&&this.crewMessage)body+='<p class="ct-crew-feedback" role="status" data-positive="'+String(this.crewSuccess)+'">'+escape(this.crewMessage)+'</p>';
        body+='</section>';
      }
      body+='</div>';
    }
    body+='<p class="ct-crew-status" role="status" aria-live="polite" data-positive="'+String(this.crewSuccess)+'">'+escape(this.crewTab==='tasks'&&this.crewFeedback?'':this.crewMessage)+'</p>';
    return body;
  }
  private renderCrewDialog(){
    if(!this.crewDialog||this.disposed)return;
    const panel=this.element('.ct-modal'),top=panel.scrollTop,active=document.activeElement instanceof HTMLElement?document.activeElement:undefined,focus=active?.dataset.ctModal,challenge=active?.closest<HTMLElement>('[data-challenge-id]')?.dataset.challengeId;
    panel.innerHTML=this.crewBody()+'<button type="button" class="ct-modal-close" data-ct-modal="close">'+this.text('Закрыть','Close')+'</button>';panel.scrollTop=top;
    const target=Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-ct-modal]')).find(button=>button.dataset.ctModal===focus&&!button.disabled);
    if(target)target.focus({preventScroll:true});else if(!panel.contains(document.activeElement)){
      const next=Array.from(panel.querySelectorAll<HTMLElement>('[data-challenge-id]')).find(section=>section.dataset.challengeId===challenge)??panel.querySelector<HTMLElement>('.ct-crew-close');next?.focus({preventScroll:true});
    }
    this.crewNewlyUnlocked='';
  }
  private async loadCrew(){
    if(!this.account||this.disposed||this.crewBusy||this.choosingCaptain)return;
    const account=this.account,load=++this.crewLoad;this.crewLoading=true;this.renderCrewDialog();
    try{
      const profile=await crewCollection(account,this.crewAbort.signal);
      if(this.disposed||account!==this.account||load!==this.crewLoad)return;
      this.crewProfile=profile;this.crewPendingCaptain=profile.selected;
    }catch(error){if(!this.disposed&&account===this.account&&load===this.crewLoad){this.crewMessage=this.crewError(error);this.crewSuccess=false;}}
    finally{if(!this.disposed&&account===this.account&&load===this.crewLoad){this.crewLoading=false;this.renderCrewDialog();this.render();}}
  }
  private restoreCrewCaptain(){
    const desired=this.crewPendingCaptain;
    if(!desired||this.presenting||this.choosingCaptain||this.captain.state().loading)return;
    this.crewPendingCaptain=undefined;const account=this.account,request=this.crewRequest;
    void this.captain.select(desired).then(async selected=>{
      if(this.disposed||account!==this.account||request!==this.crewRequest)return;
      if(!selected&&this.presenting){this.crewPendingCaptain=desired;return;}
      if(!selected)await this.captain.select(DEFAULT_CAPTAIN);
      if(!this.disposed&&account===this.account&&request===this.crewRequest)this.render();
    });
  }
  private async crewAction(request:CrewRequest){
    if(!this.account||!this.crewProfile||this.crewBusy||this.choosingCaptain)return;
    const account=this.account;this.crewLoad++;this.crewLoading=false;this.crewBusy=true;this.crewMessage='';this.crewSuccess=false;this.crewFeedback=request.action==='answer'?request.challengeId:'';this.renderCrewDialog();
    try{
      const profile=await crewCollection(account,this.crewAbort.signal,request);
      if(this.disposed||account!==this.account)return;
      this.crewProfile=profile;this.crewSuccess=true;
      if(profile.receipt?.unlocked){this.crewNewlyUnlocked=profile.receipt.unlocked;this.crewMessage=this.text('Героиня открыта навсегда. Теперь её можно выбрать.','The captain is permanently unlocked. You can now select her.');}
      else if(profile.receipt?.reward)this.crewMessage=this.text('Задание выполнено: +','Challenge complete: +')+profile.receipt.reward+' '+this.text('жетонов команды.','crew tokens.');
      else this.crewMessage=this.text('Коллекция обновлена.','Collection updated.');
      this.audio.cue('click');
    }catch(error){if(!this.disposed&&account===this.account)this.crewMessage=this.crewError(error);}
    finally{if(!this.disposed&&account===this.account){this.crewBusy=false;this.renderCrewDialog();this.render();}}
  }
  private async chooseCaptain(id:string){
    if(!this.crewDialog||this.choosingCaptain||this.crewBusy||!crewMember(id)||!this.crewProfile?.owned.includes(id as CrewId)||!this.account)return;
    this.choosingCaptain=true;this.crewLoad++;this.crewLoading=false;this.crewPendingCaptain=undefined;const request=++this.crewRequest,account=this.account;
    this.crewMessage=this.text('Готовим образ...','Preparing the look...');this.crewSuccess=false;this.renderCrewDialog();
    try{
      const selected=await this.captain.select(id,async()=>{
        const profile=await crewCollection(account,this.crewAbort.signal,{id:crypto.randomUUID(),action:'select',characterId:id});
        if(this.disposed||account!==this.account)return false;
        if(request!==this.crewRequest){if(!this.choosingCaptain&&!this.crewBusy)void this.loadCrew();return false;}
        this.crewProfile=profile;return true;
      });
      if(this.disposed||account!==this.account||request!==this.crewRequest)return;
      this.choosingCaptain=false;
      if(selected)this.closeDialog();
      else if(this.crewDialog){this.crewMessage=this.text('Не удалось загрузить образ. Попробуй ещё раз.','The look could not load. Please try again.');this.renderCrewDialog();}
    }catch(error){
      if(this.disposed||account!==this.account||request!==this.crewRequest)return;
      this.choosingCaptain=false;this.crewMessage=this.crewError(error);this.crewSuccess=false;await this.loadCrew();
    }
    this.render();
  }
  private closeDialog() {
    if(this.choosingCaptain){this.crewRequest++;this.choosingCaptain=false;this.captain.cancelSelection();}
    this.crewDialog=false;this.dialogKind = ''; this.dialog?.hide(); if (!this.disposed && this.root) this.render();
  }
  getState() {
    return {gameId:CARIBBEAN_GAME,phase:this.view?.phase ?? 'ready',sessionId:this.session?.id ?? null,
      revision:this.view?.revision ?? 0,lines:this.lines,lineStakeUnits:this.lineStake,pendingId:this.client.pending?.id ?? null,
      presenting:this.presenting,visualPhase:this.visualPhase,autoplay:{running:this.autoRunning,remaining:this.autoRemaining,count:this.autoCount,timerPending:!!this.autoTimer,note:this.autoNote,waitingForTactic:this.autoRunning&&this.view?.phase==='choice'},audio:this.audio.state(),captain:this.captain.state(),collection:this.crewProfile?{tokens:this.crewProfile.tokens,owned:[...this.crewProfile.owned],selected:this.crewProfile.selected,day:this.crewProfile.day,revision:this.crewProfile.revision}:null,visuals:this.visuals.state(),accents:[...this.accents]};
  }
  destroy() {
    if (this.disposed) return;
    this.stopAuto('stopped',false);this.stopPresentation();this.disposed = true;this.crewAbort.abort();this.captain.destroy();this.visuals.cancel();this.audio.destroy();this.unsubscribeAudio(); this.lifetime.abort(); this.dialog.destroy(); this.root.remove();
  }
}
