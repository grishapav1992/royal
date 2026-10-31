import {stakeRulesHtml} from '../../src/ui/stakeRules';
import {GAME_BETS as DEMO_BETS} from '../../src/shared/gameStakes';
import { readGameHost } from '../../src/modules/GameHostContract';
import { type WalletResult } from '../../src/shared/demoWallet';
import { rouletteRedNumbers, type RouletteInput, type RouletteRound } from '../../src/shared/gameCore';
import type { WalletSettlement } from '../../src/wallet/WalletClient';
import { rouletteWheelSvg } from './WheelArtwork';
import { RouletteSound } from './RouletteSound';
import { RouletteMotion } from './RouletteMotion';
import './roulette.css';

const wheel = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const reds = new Set<number>(rouletteRedNumbers);
const color = (n: number) => n === 0 ? 'green' : reds.has(n) ? 'red' : 'black';

export class RoyalRoulette {
  private host = readGameHost();
  private wallet = this.host.demoWallet;
  private root = document.createElement('section');
  private lifetime = new AbortController();
  private alive = true;
  private busy = false;
  private paused = false;
  private account = this.wallet.accountId;
  private input: RouletteInput = {bet:'red'};
  private amount: number = 0.1;
  private motion: RouletteMotion;
  private sound: RouletteSound;
  private last?: RouletteRound;
  private history: number[] = [];
  private shown = new Set<string>();
  private status = '';
  private text(ru: string, en: string) { return this.host.i18n.language === 'en' ? en : ru; }
  private el<T extends HTMLElement = HTMLElement>(query: string) { return this.root.querySelector<T>(query)!; }
  private money(units: string) { return this.host.walletCoins(Number(units) / 100); }
  private label(input = this.input) {
    return input.bet === 'number' ? `${this.text('Число','Number')} ${input.number}`
      : ({red:this.text('Красное','Red'),black:this.text('Чёрное','Black'),even:this.text('Чётное','Even'),odd:this.text('Нечётное','Odd')})[input.bet];
  }
  constructor(container: HTMLElement) {
    this.root.className = 'rr-root';
    this.root.setAttribute('aria-label', this.text('Европейская рулетка','European roulette'));
    this.root.innerHTML = `<header class="rr-header"><div class="rr-brand"><span class="rr-crest" aria-hidden="true">♛</span><div><span class="rr-eyebrow">ROYAL CASINO</span><h2>${this.text('Рулетка','Roulette')}</h2></div><span class="rr-edition">${this.text('ЕВРОПЕЙСКАЯ','EUROPEAN')}<b>SINGLE ZERO</b></span></div><button type="button" class="rr-wallet"><span class="rr-wallet-icon" aria-hidden="true">◈</span><span><small>${this.text('Общий демобаланс','Shared demo balance')}</small><strong data-rr-balance></strong></span><span class="rr-wallet-plus" aria-hidden="true">+</span></button></header>
      <div class="rr-content"><div class="rr-wheel-area"><div class="rr-wheel-heading"><span>${this.text('ЕВРОПЕЙСКОЕ КОЛЕСО','EUROPEAN WHEEL')}</span><span>0 - 36</span></div><div class="rr-wheel">${rouletteWheelSvg(wheel,color)}</div><div class="rr-center"><div class="rr-result-orb"><strong data-rr-number>?</strong></div><div class="rr-result-copy"><span>${this.text('ПОСЛЕДНИЙ РЕЗУЛЬТАТ','LAST RESULT')}</span><small data-rr-color>${this.text('Сделайте ставку','Place your bet')}</small></div><span class="rr-result-mark" aria-hidden="true">✧</span></div><div class="rr-history" data-empty="${this.text('Здесь появятся последние результаты','Your recent results will appear here')}" aria-label="${this.text('Последние результаты','Recent results')}"></div></div>
      <div class="rr-table-area"><div class="rr-table-heading"><div><span class="rr-eyebrow">${this.text('ИГРОВОЙ СТОЛ','BETTING TABLE')}</span><h3>${this.text('Сделайте ставку','Place your bet')}</h3></div><span class="rr-one-bet">${this.text('Одна ставка за раунд','One bet per round')}</span></div>
      <div class="rr-outside-heading"><span>${this.text('Цвет и чётность','Colour and parity')}</span><span>${this.text('Выплата','Return')} <b>×2</b></span></div><div class="rr-outside" role="group" aria-label="${this.text('Ставки с выплатой ×2','Bets paying ×2')}">${(['red','black','even','odd'] as const).map(bet=>`<button type="button" data-rr-bet="${bet}" class="rr-${bet}" aria-label="${this.label({bet})}"><i class="rr-bet-symbol" aria-hidden="true">${bet==='red'||bet==='black'?'◆':bet==='even'?'2 / 4':'1 / 3'}</i><span>${this.label({bet})}</span><small>×2</small></button>`).join('')}</div>
      <div class="rr-number-heading"><span>${this.text('Или выберите одно число','Or choose a single number')}</span><span>${this.text('Выплата','Return')} <b>×36</b></span></div><div class="rr-numbers" role="group" aria-label="${this.text('Ставка на число','Straight number bet')}">${Array.from({length:37},(_,n)=>`<button type="button" data-rr-bet="number" data-rr-value="${n}" class="rr-${color(n)}" style="--rr-col:${n===0?1:Math.ceil(n/3)+1};--rr-row:${n===0?1:3-(n-1)%3};--rr-mobile-col:${n===0?1:(n-1)%6+2};--rr-mobile-row:${n===0?1:Math.floor((n-1)/6)+1}" aria-label="${this.label({bet:'number',number:n})}"><span>${n}</span></button>`).join('')}</div>
      <details class="rr-rules"><summary><span>${this.text('Правила и выплаты','Rules and payouts')}</span><span class="rr-rtp">RTP ${this.text('97,30%','97.30%')}</span></summary><p>${this.text('Выберите одну ставку. Красное, чёрное, чётное и нечётное возвращают ×2; одно число возвращает ×36. Выплата включает ставку. Ноль проигрывает всем ставкам на цвет и чётность, но выигрывает ставку на число 0.','Choose one bet. Red, black, even and odd return ×2; a straight number returns ×36. Returns include the stake. Zero loses all colour and parity bets and wins a straight bet on 0.')}</p><p>${this.text('Точный теоретический RTP: 36/37, примерно 97,30%. Результаты независимы. Предыдущие числа и увеличение ставки не предсказывают следующий исход.','Exact theoretical RTP: 36/37, approximately 97.30%. Outcomes are independent. Previous numbers and increased stakes do not predict the next outcome.')}</p><p>${this.text('Бесплатные виртуальные USDT из общего кошелька клуба. Вывод недоступен.','Free virtual USDT from the shared club wallet. Withdrawals are unavailable.')}</p>${stakeRulesHtml()}</details></div></div>
      <footer class="rr-footer"><div class="rr-selection"><span class="rr-selection-mark" aria-hidden="true">◆</span><div><small>${this.text('Ваша ставка','Your bet')}</small><strong data-rr-selection></strong></div></div><div class="rr-stake-picker"><span>${this.text('Сумма ставки, USDT','Stake, USDT')}</span><div class="rr-chips" role="group" aria-label="${this.text('Сумма ставки','Stake amount')}">${DEMO_BETS.map(amount=>`<button type="button" data-rr-amount="${amount}" aria-label="${amount} USDT"><span>${amount}</span></button>`).join('')}</div></div><button type="button" class="rr-spin" data-rr-spin><span class="rr-spin-glyph" aria-hidden="true">↻</span><span data-rr-spin-copy></span><span class="rr-spin-arrow" aria-hidden="true">›</span></button><div class="rr-status" role="status" aria-live="polite"></div><div class="rr-return"><span>${this.text('Выплата','Return')} <strong data-rr-payout>0</strong><small>USDT</small></span><span>${this.text('Итог раунда','Round net')} <strong data-rr-net>0</strong><small>USDT</small></span></div></footer>`;

    container.replaceChildren(this.root);
    this.sound = new RouletteSound(this.host.gameAudio);
    this.motion = new RouletteMotion(this.root,this.sound);
    for (const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-rr-bet]'))) {
      button.addEventListener('click',()=>{
        if (this.locked()) return;
        this.input = button.dataset.rrBet === 'number' ? {bet:'number',number:Number(button.dataset.rrValue)} : {bet:button.dataset.rrBet as 'red'|'black'|'even'|'odd'};
        this.render();this.motion.select(button);
      },{signal:this.lifetime.signal});
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-rr-amount]').forEach(button => {
      button.addEventListener('click', () => {
        if (this.locked()) return;
        this.amount = Number(button.dataset.rrAmount); this.render();this.motion.select(button);
      }, {signal:this.lifetime.signal});
    });
    this.el('[data-rr-spin]').onclick=()=>{void this.spin();};
    this.el('.rr-wallet').onclick=()=>window.dispatchEvent(new Event('royal-open-wallet'));
    this.wallet.addEventListener('change',()=>this.render(),{signal:this.lifetime.signal});
    this.wallet.addEventListener('settlement',event=>{
      const {accountId,operation,result}=(event as CustomEvent<WalletSettlement>).detail;
      if (!this.alive||this.busy||accountId!==this.wallet.accountId||operation.kind!=='play'||operation.gameId!=='royal-roulette')return;
      void this.present(result,accountId,operation.id,false,operation.input as RouletteInput,operation.amount).catch(()=>{this.status=this.text('Не удалось проверить результат. Обновите кошелёк.','Could not verify the result. Refresh the wallet.');this.render();});
    },{signal:this.lifetime.signal});
    this.render();
  }
  private pending() { const p=this.wallet.pending;return p?.kind==='play'&&p.gameId==='royal-roulette'?p:undefined; }
  private locked() { return this.busy||this.wallet.busy||this.wallet.externalBusy||!!this.wallet.pending; }
  private render() {
    if(!this.alive)return;
    if(this.account!==this.wallet.accountId){
      this.account=this.wallet.accountId;this.motion.reset();this.busy=false;this.last=undefined;this.history=[];this.shown.clear();this.status='';
      delete this.el('.rr-center').dataset.color;
      this.root.querySelectorAll('.rr-landed').forEach(cell=>cell.classList.remove('rr-landed'));
      this.el('[data-rr-number]').textContent='?';this.el('[data-rr-color]').textContent=this.text('Сделайте ставку','Place your bet');this.el('.rr-history').replaceChildren();
    }
    const pending=this.pending();
    if(pending){this.input=structuredClone(pending.input) as RouletteInput;this.amount=pending.amount;}
    else if(!this.busy&&!DEMO_BETS.includes(this.amount))this.amount=0.1;
    this.root.dataset.busy=String(this.busy);
    this.el('[data-rr-balance]').textContent=this.wallet.wallet?`${this.host.walletCoins(this.wallet.wallet.balance)} USDT`:'…';
    this.root.querySelectorAll<HTMLButtonElement>('[data-rr-amount]').forEach(button => {
      button.disabled = this.locked();
      button.setAttribute('aria-pressed', String(Number(button.dataset.rrAmount) === this.amount));
    });
    for(const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-rr-bet]'))){
      b.disabled=this.locked();b.setAttribute('aria-pressed',String(b.dataset.rrBet===this.input.bet&&(this.input.bet!=='number'||Number(b.dataset.rrValue)===this.input.number)));
    }
    this.el('[data-rr-selection]').textContent=`${this.label()} · ×${this.input.bet==='number'?36:2}`;
    const button=this.el<HTMLButtonElement>('[data-rr-spin]');
    const action=this.busy?this.text('Вращение…','Spinning…'):pending?this.text('Проверить результат','Check result'):this.text('Крутить колесо','Spin wheel');
    this.el('[data-rr-spin-copy]').textContent=action;button.setAttribute('aria-label',action);
    button.disabled=this.busy||this.wallet.busy||this.wallet.externalBusy||!this.wallet.accountId||!!this.wallet.pending&&!pending||(!pending&&(!this.wallet.wallet||this.wallet.wallet.balance<this.amount));
    let message=this.status||this.text('Выберите поле и запустите колесо.','Choose a bet and spin the wheel.');
    if(!this.busy){
      if(pending)message=this.wallet.error||this.text('Ставка сохранена. Проверьте результат перед новой игрой.','Your bet is saved. Check its result before a new round.');
      else if(this.wallet.pending||this.wallet.externalBusy)message=this.text('Сначала завершите операцию в другой игре.','Finish the operation in the other game first.');
      else if(!this.wallet.accountId)message=this.text('Войдите в онлайн-зал, чтобы играть.','Enter the online hall to play.');
      else if(!this.wallet.wallet)message=this.wallet.error||this.text('Обновляем общий кошелёк…','Refreshing the shared wallet…');
      else if(this.wallet.wallet.balance<this.amount&&!this.last)message=this.text('Недостаточно USDT. Пополните демобаланс или уменьшите ставку.','Not enough USDT. Add demo funds or lower your stake.');
    }
    this.el('.rr-status').textContent=message;
    this.el('[data-rr-payout]').textContent=this.last?this.money(this.last.payoutUnits):'0';
    this.root.dataset.result=this.last?(this.last.multiplier>0?'win':'loss'):'idle';
    const net=this.last?BigInt(this.last.payoutUnits)-BigInt(this.last.stakeUnits):0n;
    this.el('[data-rr-net]').textContent=`${net>0n?'+':''}${this.money(String(net))}`;
  }
  private checked(result: WalletResult,input: RouletteInput,amount: number): RouletteRound {
    const round=result.gameRound;
    if(!round||round.gameId!=='royal-roulette'||round.rulesVersion!==1||!('bet'in round.input)||round.input.bet!==input.bet||input.bet==='number'&&(!('number'in round.input)||round.input.number!==input.number)||round.stakeUnits!==String(amount*100)||!('number'in round.outcome))throw Error('Invalid roulette receipt');
    const n=round.outcome.number;
    if(!Number.isInteger(n)||n<0||n>36)throw Error('Invalid roulette outcome');
    const won=input.bet==='number'?n===input.number:n!==0&&(input.bet==='red'?reds.has(n):input.bet==='black'?!reds.has(n):input.bet==='even'?n%2===0:n%2===1);
    const multiplier=won?(input.bet==='number'?36:2):0;
    if(round.multiplier!==multiplier||round.payoutUnits!==String(BigInt(round.stakeUnits)*BigInt(multiplier)))throw Error('Invalid roulette payout');
    return round;
  }
  private async spin() {
    const pending=this.pending();
    if(this.busy||this.wallet.busy||this.wallet.externalBusy||!this.wallet.accountId||this.wallet.pending&&!pending)return;
    if(!pending&&(!this.wallet.wallet||this.wallet.wallet.balance<this.amount))return;
    const account=this.wallet.accountId,input=structuredClone(pending?.input??this.input) as RouletteInput,amount=pending?.amount??this.amount;
    this.busy=true;this.status=this.text('Подтверждаем ставку…','Confirming your bet…');this.render();this.motion.begin();
    try{
      const operation=pending?this.wallet.retry():this.wallet.play('royal-roulette',input,amount);
      const id=this.wallet.pending?.id;
      const result=await operation;
      if(!id)throw Error('Missing accepted roulette operation');
      await this.present(result,account,id,true,input,amount);
    }catch(error){if(this.alive&&account===this.wallet.accountId){this.motion.cancel();this.status=error instanceof Error&&this.host.i18n.isUserMessage(error.message)?error.message:this.text('Не удалось подтвердить результат. Проверьте кошелёк.','Could not confirm the result. Check the wallet.');}}
    finally{if(this.alive&&account===this.wallet.accountId){this.busy=false;this.render();}}
  }
  private async present(result: WalletResult,account: string,id: string,animate: boolean,input: RouletteInput,amount: number) {
    if(!this.alive||this.wallet.accountId!==account||this.shown.has(id))return;
    const round=this.checked(result,input,amount),n=round.outcome.number;
    this.shown.add(id);
    let observed=false;
    if(animate){
      this.status=this.text('Шарик в движении…','The ball is rolling…');this.render();
      observed=await this.motion.land(wheel.indexOf(n));
    }else this.motion.snap(wheel.indexOf(n));
    if(!this.alive||account!==this.wallet.accountId)return;
    this.motion.snap(wheel.indexOf(n));
    this.last=round;this.history.unshift(n);this.history=this.history.slice(0,10);
    this.el('[data-rr-number]').textContent=String(n);this.el('.rr-center').dataset.color=color(n);
    this.el('[data-rr-color]').textContent=n===0?this.text('Зеро','Zero'):reds.has(n)?this.text('Красное','Red'):this.text('Чёрное','Black');
    for(const b of Array.from(this.root.querySelectorAll<HTMLElement>('[data-rr-value]')))b.classList.toggle('rr-landed',Number(b.dataset.rrValue)===n);
    this.motion.history(n,color(n),observed);
    this.status=round.multiplier>0?`${this.text('Выпало','Result')} ${n}. ${this.text('Выплата','Return')}: ${this.money(round.payoutUnits)} USDT.`:`${this.text('Выпало','Result')} ${n}. ${this.text('Ставка проиграла.','Your bet lost.')}`;
    this.render();
    if(observed&&!this.paused&&!document.hidden){this.motion.reveal(round.multiplier);this.host.reactions.emitGameOutcome(this.root,round.stakeUnits,round.payoutUnits);}
  }
  pause(){this.paused=true;this.motion.pause();}
  resume(){this.paused=false;this.motion.resume();}
  getState(){return{gameId:'royal-roulette',busy:this.busy,input:this.input,amount:this.amount,result:this.last??null,history:[...this.history],motion:this.motion.state(),sound:this.sound.state()};}
  destroy(){if(!this.alive)return;this.alive=false;this.motion.destroy();this.sound.destroy();this.lifetime.abort();this.root.remove();}
}
