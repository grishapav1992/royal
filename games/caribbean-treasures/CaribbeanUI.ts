import { readGameHost } from '../../src/modules/GameHostContract';
import {
  CARIBBEAN_GAME, caribbeanInitialCost, validCaribbeanStake,
  type CaribbeanSettings, type CaribbeanStartMode, type CaribbeanView,
} from '../../src/shared/caribbeanTreasures';
import {
  CARIBBEAN_LINE_COUNTS, CARIBBEAN_LINE_STAKES, CARIBBEAN_LINES, CARIBBEAN_SYMBOLS,
  validCaribbeanLineCount, type CaribbeanLineCount,
} from '../../src/shared/caribbeanTreasuresMath';
import { SlotDialog, slotOwnsKeyboard, type SlotDialogKind } from '../../src/ui/slotKit/SlotDialog';
import { caribbeanIcon } from './icons';
import {CaribbeanAudio,type CaribbeanCue} from './CaribbeanAudio';
import {caribbeanOutcome,caribbeanBeforeReveal} from './presentation';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
const namesEn = ['Map','Compass','Pistol','Cutlass','Ruby','Parrot'];
export class CaribbeanUI {
  private services = readGameHost();
  private client = this.services.expansionClient;
  private lifetime = new AbortController();
  private root: HTMLElement;
  private dialog: SlotDialog;
  private dialogKind: SlotDialogKind = '';
  private disposed = false;
  private lines: CaribbeanLineCount = 20;
  private lineStake = '100';
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
  private accents:{cue:string;deviationMs:number}[]=[];
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
  private get blocked() {
    return this.presenting || this.paused || !this.client.accountId || !this.client.wallet || this.client.busy || this.client.loading || !!this.client.pending
      || this.services.demoWallet.busy || !!this.services.demoWallet.pending || this.services.demoWallet.hasExternalBusy('expansion');
  }
  constructor(host: HTMLElement) {
    this.root = document.createElement('section');
    this.root.className = 'ct-root';
    this.root.setAttribute('aria-label',this.title);
    this.root.innerHTML = '<header class="ct-heading"><span class="ct-avatar"><img src="/assets/caribbean-treasures/captain.webp" alt=""></span><div class="ct-title"><small>ROYAL · CARIBBEAN</small><h2></h2></div><div class="ct-header-tools"><button type="button" data-ct-action="sound">♪</button><button type="button" data-ct-action="music">♫</button><button type="button" data-ct-action="info">?</button><button type="button" data-ct-action="history">≡</button></div></header>'
      + '<div class="ct-stage"><div class="ct-board-wrap"><div class="ct-board" role="img"></div><div class="ct-waiting" hidden></div></div><aside class="ct-captain" aria-hidden="true"><img src="/assets/caribbean-treasures/captain.webp" alt=""><img class="ct-captain-win" src="/assets/caribbean-treasures/captain-win.webp" alt=""></aside><div class="ct-map" role="status"></div></div>'
      + '<div class="ct-ledger"><div><span data-ct-label="balance"></span><strong data-ct-balance></strong></div><div><span data-ct-label="cost"></span><strong data-ct-cost></strong></div><div><span data-ct-label="payout"></span><strong data-ct-payout></strong></div><div><span data-ct-label="net"></span><strong data-ct-net></strong></div></div>'
      + '<div class="ct-controls"><div class="ct-lines-control"><label for="ct-lines-input" data-ct-label="lines"></label><span class="ct-stepper"><button type="button" data-ct-action="lines-down">−</button><select id="ct-lines-input" data-ct-lines></select><button type="button" data-ct-action="lines-up">+</button></span></div><div class="ct-stake-control"><label for="ct-stake-input" data-ct-label="stake"></label><span class="ct-stepper"><button type="button" data-ct-action="stake-down">−</button><select id="ct-stake-input" data-ct-stake></select><button type="button" data-ct-action="stake-up">+</button></span></div><button type="button" data-ct-action="lines"></button><button type="button" data-ct-action="buy"></button><button type="button" class="ct-play" data-ct-action="play"><span class="ct-spin-icon" aria-hidden="true">↻</span><b></b><small></small></button></div>'
      + '<div class="ct-status" role="status" aria-live="polite"></div><div class="ct-choice" hidden></div><button type="button" class="ct-retry" data-ct-action="retry" hidden></button><button type="button" class="ct-skip" data-ct-action="skip" hidden></button>'
      + '<div class="ct-backdrop" hidden><section class="ct-modal" role="dialog" aria-modal="true"></section></div>';
    host.replaceChildren(this.root);
    this.root.querySelector('h2')!.textContent = this.title;
    this.element<HTMLSelectElement>('[data-ct-lines]').innerHTML = CARIBBEAN_LINE_COUNTS.map(lines => '<option>' + lines + '</option>').join('');
    this.element<HTMLSelectElement>('[data-ct-stake]').innerHTML = CARIBBEAN_LINE_STAKES.map(stake => '<option value="' + stake + '">' + this.money(stake) + '</option>').join('');
    this.dialog = new SlotDialog(this.element('.ct-modal'),this.element('.ct-backdrop'),'data-ct-modal',
      action => { this.closeDialog(); if (action === 'buy-raid' || action === 'buy-flagship') void this.start(action); },
      () => this.closeDialog());
    this.root.addEventListener('click',event => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>('[data-ct-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.ctAction;
      if (action === 'info' || action === 'history') this.openDialog(action);
      else if (action === 'skip') this.stopPresentation();
      else if (action === 'sound') { const p=this.services.gameAudio.getPreferences();this.services.gameAudio.setMuted(!p.muted);void this.audio.enter(); }
      else if (action === 'music') {this.audio.setMusic(!this.audio.musicEnabled());void this.audio.enter();this.render();}
      else if (action === 'lines') { this.showLines = !this.showLines; this.render(); }
      else if (action?.startsWith('lines-') || action?.startsWith('stake-')) {
        if(this.blocked || this.active || this.dialogKind)return;
        const direction=action.endsWith('up')?1:-1;
        if(action.startsWith('lines-'))this.lines=CARIBBEAN_LINE_COUNTS[Math.max(0,Math.min(3,CARIBBEAN_LINE_COUNTS.indexOf(this.lines)+direction))];
        else this.lineStake=CARIBBEAN_LINE_STAKES[Math.max(0,Math.min(3,CARIBBEAN_LINE_STAKES.findIndex(stake=>stake===this.lineStake)+direction))];
        this.audio.cue('click');this.render();
      }
      else if (action === 'buy') { if (!this.blocked && !this.active) this.openDialog('buy'); }
      else if (action === 'play') {
        if (this.active) void this.move('caribbean-spin');
        else void this.start('normal');
      } else if (action === 'choose-raid' || action === 'choose-flagship') void this.move('caribbean-' + action);
      else if (action === 'retry') { if (!this.client.busy) void this.client.retry().catch(() => {}).finally(() => this.update()); }
    },{signal:this.lifetime.signal});
    this.root.addEventListener('change',event => {
      if (this.blocked || this.active || this.dialogKind) { this.render(); return; }
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.matches('[data-ct-lines]')) {
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
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stopPresentation();},{signal:this.lifetime.signal});
    this.motionPreference.addEventListener('change',()=>{if(this.reduced)this.stopPresentation();else this.render();},{signal:this.lifetime.signal});
    this.unsubscribeAudio=this.services.gameAudio.onPreferences(()=>this.render());
    this.update(); void this.client.refresh();
  }
  private element<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private update = () => {
    if (this.disposed) return;
    if (this.account !== this.client.accountId) {
      this.stopPresentation();this.account = this.client.accountId; this.sessionKey = ''; this.lines = 20; this.lineStake = '100'; this.closeDialog();
    }
    const session = this.session, view = this.view, key = session && view ? session.id + ':' + view.revision : '';
    if (view && key !== this.sessionKey) {
      this.lines = view.settings.lines; this.lineStake = view.lineStakeUnits; this.sessionKey = key;
    }
    if (this.dialogKind === 'buy' && this.blocked) this.closeDialog();
    this.render();
  };
  private render() {
    if (this.disposed) return;
    const view = this.presenting ? this.displayed : this.view, frame = view?.spins.at(-1)?.frame;
    this.root.dataset.ctPhase=this.visualPhase;this.root.dataset.motion=this.reduced?'reduced':'full';
    this.root.dataset.outcome=view?.phase==='complete'?caribbeanOutcome(view):'';
    this.root.setAttribute('aria-busy',String(this.presenting||this.client.busy));
    const sound=this.element<HTMLButtonElement>('[data-ct-action=sound]'),music=this.element<HTMLButtonElement>('[data-ct-action=music]');
    const muted=this.services.gameAudio.getPreferences().muted;sound.setAttribute('aria-label',this.text(muted?'Включить звук':'Выключить звук',muted?'Enable sound':'Mute sound'));sound.setAttribute('aria-pressed',String(!muted));
    music.setAttribute('aria-label',this.text(this.audio.musicEnabled()?'Выключить музыку':'Включить музыку',this.audio.musicEnabled()?'Mute music':'Enable music'));music.setAttribute('aria-pressed',String(this.audio.musicEnabled()));
    const waiting=this.element('.ct-waiting');waiting.hidden=this.visualPhase!=='waiting';waiting.textContent=this.text('Подтверждаем ход...','Confirming operation...');
    const skip=this.element('[data-ct-action=skip]');skip.hidden=!this.presenting||this.visualPhase==='waiting';skip.textContent=this.text('Показать итог сразу','Show final result');
    const lines = this.element<HTMLSelectElement>('[data-ct-lines]'), stake = this.element<HTMLSelectElement>('[data-ct-stake]');
    lines.value = String(this.lines); stake.value = this.lineStake;
    lines.disabled = stake.disabled = this.blocked || !!this.active || !!this.dialogKind;
    for(const kind of ['lines','stake'])for(const direction of ['down','up']){
      const button=this.element<HTMLButtonElement>('[data-ct-action='+kind+'-'+direction+']');
      const index=kind==='lines'?CARIBBEAN_LINE_COUNTS.indexOf(this.lines):CARIBBEAN_LINE_STAKES.findIndex(stake=>stake===this.lineStake);
      button.disabled=lines.disabled || (direction==='down'?index===0:index===3);
      button.setAttribute('aria-label',this.text(direction==='down'?'Уменьшить ':'Увеличить ',direction==='down'?'Decrease ':'Increase ')+this.text(kind==='lines'?'число линий':'ставку на линию',kind==='lines'?'lines':'stake per line'));
    }
    for (const [key,label] of Object.entries({
      balance:this.text('Баланс · USDT','Balance · USDT'),
      cost:this.active ? this.text('Цена принятого раунда','Accepted round cost') : this.text('Ставка за вращение','Spin cost'),payout:this.active ? this.text('Накоплено в раунде','Round total') : this.text('Выплата раунда','Round payout'),
      net:this.text('Чистый итог раунда','Net round result'),lines:this.text('Линии','Lines'),stake:this.text('На линию · USDT','Per line · USDT'),
    })) this.element('[data-ct-label="' + key + '"]').textContent = label;
    this.element('[data-ct-balance]').textContent = this.client.wallet ? this.services.walletCoins(this.client.wallet.balance) : '...';
    this.element('[data-ct-cost]').textContent = this.view && this.active ? this.money(this.view.costUnits) : this.money(caribbeanInitialCost({lines:this.lines,mode:'normal'},this.lineStake));
    this.element('[data-ct-payout]').textContent = this.money(this.tally ?? view?.totalPayoutUnits ?? '0');
    const net = view && !this.active ? BigInt(view.totalPayoutUnits) - BigInt(view.costUnits) : null;
    this.element('[data-ct-net]').textContent = net === null ? (this.active ? this.text('Серия идёт','Round in progress') : '...') : (net > 0n ? '+' : '') + this.money(String(net));
    this.element('[data-ct-net]').dataset.positive = String(net !== null && net > 0n);
    this.element<HTMLButtonElement>('[data-ct-action=info]').setAttribute('aria-label',this.text('Правила и выплаты','Rules and payouts'));
    this.element<HTMLButtonElement>('[data-ct-action=history]').setAttribute('aria-label',this.text('История раунда','Round history'));
    this.element('[data-ct-action=lines]').textContent = this.text('Показать линии','Show lines');
    this.element('[data-ct-action=lines]').setAttribute('aria-pressed',String(this.showLines));
    const buy = this.element<HTMLButtonElement>('[data-ct-action=buy]');
    buy.textContent = this.text('Купить бонус','Buy bonus'); buy.disabled = this.blocked || !!this.active || !!this.dialogKind;
    const play = this.element<HTMLButtonElement>('[data-ct-action=play]');
    play.querySelector('b')!.textContent = view?.phase === 'choice' ? this.text('Тактика','Tactic') : this.active ? this.text('Бесплатно','Free spin') : this.text('Вращать','Spin');
    play.querySelector('small')!.textContent=view?.phase === 'choice' ? this.text('Выбери ниже','Choose below') : this.active ? this.text('Осталось ','Remaining ') + (view?.remaining ?? 0) : this.money(caribbeanInitialCost({lines:this.lines,mode:'normal'},this.lineStake))+' USDT';
    play.disabled = this.blocked || !!this.dialogKind || view?.phase === 'choice';
    const retry = this.element<HTMLButtonElement>('[data-ct-action=retry]');
    retry.hidden = !this.client.pending; retry.disabled = this.client.busy;
    retry.textContent = this.text('Проверить тот же ход','Check the same operation');
    this.element('.ct-status').textContent = this.client.error || (!this.client.accountId ? this.text('Войди в зал, чтобы играть.','Sign in to play.')
      : this.client.busy ? this.text('Подтверждаем ход...','Confirming...')
      : this.services.demoWallet.pending ? this.text('Проверь предыдущую операцию общего кошелька.','Check the previous shared wallet operation.')
      : this.presenting && this.visualPhase!=='outcome' ? this.text('Показываем подтверждённый результат...','Revealing the confirmed result...')
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
    const paths=board.querySelector<SVGElement>('.ct-paths')!,pathKey=JSON.stringify([[...paid],block,this.showLines,this.lines]);
    if(paths.dataset.paths!==pathKey){paths.dataset.paths=pathKey;paths.innerHTML=[...paid].filter(position=>!insideBlock(position)).map(position=>'<rect x="'+(position%6*100+4)+'" y="'+(Math.floor(position/6)*100+4)+'" width="92" height="92" rx="6"/>').join('')
      +(this.showLines?CARIBBEAN_LINES.slice(0,this.lines).map(line=>'<polyline points="'+line.map((row,column)=>(column*100+50)+','+(row*100+50)).join(' ')+'"/>').join(''):'');}
    updateStops();
  }
  private async start(mode: CaribbeanStartMode) {
    if (this.disposed || this.blocked || this.active || this.dialogKind) return;
    const settings: CaribbeanSettings = {lines:this.lines,mode};
    try { await this.perform(()=>this.client.act({gameId:CARIBBEAN_GAME,action:'start',stakeUnits:this.lineStake,settings:{caribbean:settings}})); }
    catch { /* The shared client retains errors and uncertain operation identity. */ }
    finally { this.update(); }
  }
  private async move(move: string) {
    const session = this.session, view = this.view;
    if (this.disposed || this.blocked || !session || !view || session.state !== 'active' || this.dialogKind) return;
    if (!session.view.actions.some(action => action.move === move && action.cost === 0)) return;
    try { await this.perform(()=>this.client.act({gameId:CARIBBEAN_GAME,action:'move',sessionId:session.id,move,revision:view.revision})); }
    catch { /* Status and retry use the shared transport. */ }
    finally { this.update(); }
  }
  private outcomeLabel(view:CaribbeanView){
    const kind=caribbeanOutcome(view);
    return this.text({loss:'Раунд завершён без выплаты.',partial:'Частичный возврат. Выплата меньше стоимости раунда.',return:'Стоимость раунда возвращена.',win:'Положительный итог раунда.',bigwin:'Крупный положительный итог раунда.'}[kind],
      {loss:'Round complete without a payout.',partial:'Partial return. The payout is below the round cost.',return:'The round cost has been returned.',win:'Positive round result.',bigwin:'Large positive round result.'}[kind]);
  }
  private stopPresentation(){
    this.root?.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
    this.motion.abort();this.tally=undefined;this.presenting=false;this.displayed=undefined;this.visualPhase='idle';this.stopped=6;this.audio.pause();
    if(this.root&&!this.disposed)this.render();
  }
  private wait(ms:number,signal:AbortSignal){return new Promise<void>(resolve=>{
    if(signal.aborted){resolve();return;}const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,Math.max(0,ms));signal.addEventListener('abort',done,{once:true});
  });}
  private async accent(cue:CaribbeanCue,signal:AbortSignal,visual:()=>void,variant=0){
    if(signal.aborted||document.hidden||this.paused)return;
    const expected=this.audio.cue(cue,variant);
    // Reserve a frame for painting instead of requesting the next frame after audio is audible.
    await this.wait(expected-performance.now()-24,signal);if(signal.aborted)return;
    await new Promise<void>(resolve=>{
      const done=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',done);resolve();};
      const frame=requestAnimationFrame(()=>{if(!signal.aborted){visual();this.accents.push({cue,deviationMs:performance.now()-expected});if(this.accents.length>80)this.accents.shift();}done();});
      signal.addEventListener('abort',done,{once:true});
    });
  }
  private async perform(action:()=>Promise<unknown>){
    const previous=this.view,priorKey=this.sessionKey,account=this.client.accountId;
    this.motion.abort();const motion=this.motion=new AbortController(),signal=motion.signal;
    this.displayed=previous;this.presenting=true;this.visualPhase='waiting';this.render();void this.audio.enter();
    try{
      await action();
      if(signal.aborted||this.disposed||account!==this.client.accountId||document.hidden||this.paused)return;
      const confirmed=this.view;if(!confirmed||this.sessionKey===priorKey)return;
      if(this.reduced){this.displayed=confirmed;this.visualPhase='outcome';this.render();this.audio.cue(confirmed.phase==='complete'?caribbeanOutcome(confirmed):confirmed.phase==='choice'?'bonus':'click');return;}
      const previousInRound=this.session?.id===priorKey.split(':')[0]?previous:undefined;
      const hasSpin=confirmed.spins.length>(previousInRound?.spins.length??0);
      if(hasSpin){
        this.displayed=caribbeanBeforeReveal(confirmed,previousInRound);this.stopped=0;this.visualPhase='reels';
        // The continuous giant is revealed only after every underlying column lands.
        const beforeBlock=this.displayed.spins.at(-1)?.frame.block;
        this.displayed.spins.at(-1)!.frame.block=null;this.render();
        for(let column=0;column<6&&!signal.aborted;column++){
          await this.wait(100,signal);await this.accent('stop',signal,()=>{this.stopped=column+1;this.render();},column);
        }
        if(signal.aborted)return;
        if(beforeBlock){this.displayed.spins.at(-1)!.frame.block=beforeBlock;this.visualPhase='giant';await this.accent('giant',signal,()=>this.render());await this.wait(280,signal);}
        if(signal.aborted)return;
        if(confirmed.spins.at(-1)?.frame.cannon){this.visualPhase='cannon';await this.accent('cannon',signal,()=>{
          const old=this.root.querySelector('.ct-giant')?.getBoundingClientRect();
          this.displayed=structuredClone(confirmed);this.displayed.totalPayoutUnits=previousInRound?.totalPayoutUnits??'0';this.displayed.spins.at(-1)!.frame.wins=[];this.render();
          const giant=this.root.querySelector<HTMLElement>('.ct-giant'),next=giant?.getBoundingClientRect();
          if(giant&&old&&next)giant.animate([{transformOrigin:'0 0',transform:`translate(${old.x-next.x}px,${old.y-next.y}px) scale(${old.width/next.width},${old.height/next.height})`},{transformOrigin:'0 0',transform:'none'}],{duration:320,easing:'ease-out'});
        });await this.wait(320,signal);}
        if(signal.aborted)return;
        this.displayed=confirmed;this.visualPhase='wins';
        this.tally=previousInRound?.totalPayoutUnits??'0';
        if(confirmed.spins.at(-1)?.frame.wins.length)await this.accent('line',signal,()=>this.render());else this.render();
        const from=BigInt(this.tally),to=BigInt(confirmed.totalPayoutUnits);
        for(let step=1;step<=8&&!signal.aborted;step++){await this.wait(35,signal);if(signal.aborted)break;this.tally=String(from+(to-from)*BigInt(step)/8n);this.element('[data-ct-payout]').textContent=this.money(this.tally);}
        this.tally=undefined;
      }
      if(signal.aborted)return;
      this.displayed=confirmed;this.visualPhase='outcome';
      if(confirmed.phase==='complete')await this.accent(caribbeanOutcome(confirmed),signal,()=>this.render());
      else if(confirmed.phase==='choice'||!hasSpin)await this.accent('bonus',signal,()=>this.render());
      else this.render();
      await this.wait(confirmed.phase==='complete'&&caribbeanOutcome(confirmed)==='bigwin'?700:180,signal);
    }finally{
      if(this.motion===motion&&!this.disposed){this.tally=undefined;this.presenting=false;this.displayed=undefined;this.visualPhase='idle';this.stopped=6;this.render();}
    }
  }
  pause(){this.paused=true;this.stopPresentation();}
  resume(){this.paused=false;this.render();}
  private openDialog(kind: 'info' | 'history' | 'buy') {
    if (this.disposed) return;
    if(this.presenting)this.stopPresentation();
    this.dialogKind = kind;
    const panel = this.element('.ct-modal'), view = this.view;
    let body: string;
    if (kind === 'info') {
      body = '<h3>' + this.text('Правила и выплаты','Rules and payouts') + '</h3><p>' + this.text('6 барабанов, 4 ряда. От 3 одинаковых подряд слева направо. На одной линии оплачивается самая длинная цепочка.','6 reels, 4 rows. Match 3 or more identical symbols from the left. Only the longest run pays on each line.') + '</p>'
        + '<table><thead><tr><th>' + this.text('Символ','Symbol') + '</th><th>3</th><th>4</th><th>5</th><th>6</th></tr></thead><tbody>' + CARIBBEAN_SYMBOLS.map(symbol => '<tr><th>' + this.symbolName(symbol.id) + '</th>' + symbol.pays.map(pay => '<td>×' + pay + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
        + '<p>' + this.text('Коэффициенты относятся к ставке одной линии. Блок 2×2 может увеличиться залпом до 3×3. Расчёт выполняется по итоговому полю.','Multipliers use the stake per line. A cannon can grow a 2×2 block into 3×3. The final field determines payouts.') + '</p>'
        + '<p>' + this.text('Рейд: 14 вращений с блоком 2×2 и возможным залпом. Флагман: 6 вращений с блоком 3×3. Продления нет. Выплата всей серии начисляется в конце.','Raid: 14 spins with a 2×2 block and possible cannon. Flagship: 6 spins with a 3×3 block. No retriggers. The entire round is credited at the end.') + '</p>'
        + '<p>' + this.text('Бонусная карта открывается отдельным случайным событием после обычного вращения. Картинки карты в поле являются обычными оплачиваемыми символами. Выбирается первый набор из 1, 5, 10 или 20 фиксированных линий; отдельные маршруты не переключаются.','A separate random event after a base spin unlocks the bonus map. Map icons on the field are ordinary paying symbols. Select the first 1, 5, 10 or 20 fixed lines; individual routes cannot be switched.') + '</p>'
        + '<p>' + this.text('Теоретический RTP около 96%. Частота блоков и входа в бонус зависит от набора линий. RTP относится к полной игре на длинной дистанции.','Theoretical RTP is approximately 96%. Block and bonus entry probabilities depend on the line preset. RTP describes complete rounds over the long term.') + '</p>';
    } else if (kind === 'history') {
      body = '<h3>' + this.text('История текущего раунда','Current round history') + '</h3>' + (view ?
        '<p>' + this.text('Линий: ','Lines: ') + view.settings.lines + ' · ' + this.text('На линию: ','Per line: ') + this.money(view.lineStakeUnits) + ' USDT</p>'
          + (view.tactic ? '<p>' + (view.tactic === 'raid' ? this.text('Рейд · 14 вращений','Raid · 14 spins') : this.text('Флагман · 6 вращений','Flagship · 6 spins')) + '</p>' : '')
          + '<p>' + this.text('Стоимость: ','Cost: ') + this.money(view.costUnits) + ' USDT</p><ol>' + view.spins.map((spin,index) => '<li>' + (index + 1) + '. '
          + (spin.frame.mode === 'base' ? this.text('Обычное вращение','Base spin') : this.text('Бесплатное вращение','Free spin'))
          + ' · ' + this.money(spin.payoutUnits) + ' USDT' + (spin.frame.cannon ? this.text(' · Залп',' · Cannon') : '') + '</li>').join('') + '</ol>'
          + '<p>' + this.text('Выплата раунда: ','Round payout: ') + this.money(view.totalPayoutUnits) + ' USDT</p>' : '<p>' + this.text('Вращений пока нет.','No spins yet.') + '</p>');
    } else {
      const cost = this.money(caribbeanInitialCost({lines:this.lines,mode:'buy-raid'},this.lineStake));
      body = '<h3>' + this.text('Купить бесплатную серию','Buy a free spin series') + '</h3><p>' + this.text('Линий: ','Lines: ') + this.lines + ' · ' + this.text('На линию: ','Per line: ') + this.money(this.lineStake) + ' USDT</p><p class="ct-buy-price">' + cost + ' USDT</p><p>' + this.text('Одна покупка. Продолжения бесплатны. Выбери серию:','One purchase. Continuations are free. Choose a series:') + '</p>'
        + '<button type="button" data-ct-modal="buy-raid">' + this.text('Рейд · 14 вращений','Raid · 14 spins') + '</button>'
        + '<button type="button" data-ct-modal="buy-flagship">' + this.text('Флагман · 6 вращений','Flagship · 6 spins') + '</button>';
    }
    panel.innerHTML = body + '<button type="button" class="ct-modal-close" data-ct-modal="close">' + this.text('Закрыть','Close') + '</button>';
    panel.setAttribute('aria-label',this.text('Информация об игре','Game information'));
    this.dialog.begin(kind); this.render(); this.dialog.focus();
  }
  private closeDialog() {
    this.dialogKind = ''; this.dialog?.hide(); if (!this.disposed && this.root) this.render();
  }
  getState() {
    return {gameId:CARIBBEAN_GAME,phase:this.view?.phase ?? 'ready',sessionId:this.session?.id ?? null,
      revision:this.view?.revision ?? 0,lines:this.lines,lineStakeUnits:this.lineStake,pendingId:this.client.pending?.id ?? null,
      presenting:this.presenting,visualPhase:this.visualPhase,audio:this.audio.state(),accents:[...this.accents]};
  }
  destroy() {
    if (this.disposed) return;
    this.stopPresentation();this.disposed = true;this.audio.destroy();this.unsubscribeAudio(); this.lifetime.abort(); this.dialog.destroy(); this.root.remove();
  }
}
