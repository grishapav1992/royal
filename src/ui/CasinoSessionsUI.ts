import { decorateImportedGame } from './ImportedGameThemes';
import { t as translateText, tr, locale, language } from '../i18n/index';
import { observeGameOutcome, resetGameOutcomes } from './gameReactions';
import { casinoClients, type NewCasinoAction } from '../wallet/CasinoClient';
import { DEMO_BETS, type DemoWallet } from '../shared/demoWallet';
import { USDT_BETS, type UsdtWallet } from '../shared/usdtWallet';
import { HILO_MAX_GUESSES, type CasinoAsset, type SessionGameId } from '../shared/casinoSessions';
import { emitCardDealer } from './CardDealerStage';
import './casino-sessions.css';
const escape = (s: string) => translateText(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class CasinoSessionsUI {
  private destroyed = false;
  private asset: CasinoAsset = 'demo'; private stake = '1000'; private localError = '';
  private change = () => this.render();
  constructor(private host: HTMLElement, private game: SessionGameId) {
    resetGameOutcomes(host);
    for (const c of Object.values(casinoClients)) c.addEventListener('change', this.change);
    this.render(); void casinoClients.demo.refresh();
  }
  private format(units: string) {
    const n = BigInt(units), scale = this.asset === 'demo' ? 100n : 1000000n, decimals = this.asset === 'demo' ? 2 : 6;
    const fraction = (n % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return (n / scale).toLocaleString(locale) + (fraction ? (language === 'en' ? '.' : ',') + fraction : '') + translateText(' USDT');
  }
  private async act(op: NewCasinoAction) {
    const c = casinoClients[this.asset], account = c.accountId, asset = this.asset;
    this.localError = '';
    try { await c.act(op); }
    catch (e) { if (!this.destroyed && c.accountId === account && this.asset === asset) this.localError = (e as Error).message; }
    this.render();
  }
  private render() {
    if (this.destroyed) return;
    const c = casinoClients[this.asset], active = c.sessions.find(s => s.gameId === this.game);
    const s = active ?? (c.last?.gameId === this.game ? c.last : undefined), wallet = c.wallet;
    const playing = s?.state === 'active', blocked = c.busy || c.loading || !!c.pending;
    observeGameOutcome(this.host, { gameId: this.game, account: (c.accountId ?? '') + ':' + this.asset, sessionId: s?.id ?? '', active: !!playing, busy: c.busy, pending: c.pending?.gameId === this.game, spentUnits: s?.stakeUnits ?? '0', returnedUnits: s?.state === 'cashed_out' ? s.payoutUnits : '0' });
    if (playing) this.stake = s.stakeUnits;
    const real = this.asset === 'usdt' ? wallet as UsdtWallet | undefined : undefined;
    const ready = !!c.accountId && !!wallet && (this.asset === 'demo' || real?.state === 'assigned' && real.ready);
    const balance = this.asset === 'demo' ? (wallet as DemoWallet | undefined)?.balance.toLocaleString(locale) + translateText(' USDT')
      : real?.state === 'assigned' ? this.format(real.balanceUnits) : translateText('Недоступен');
    const bets = this.asset === 'demo' ? DEMO_BETS.map(n => String(n * 100)) : [...USDT_BETS];
    const message = !c.accountId ? translateText('Войди в аккаунт, чтобы делать ставки.') : c.loading ? translateText('Обновляем баланс и партию…')
      : this.asset === 'usdt' && !ready ? translateText('Денежный кошелёк пока недоступен для этого аккаунта. Проверь его в разделе USDT.')
      : s?.state === 'lost' ? translateText('Ставка проиграна.') : s?.state === 'cashed_out' ? translateText('Начислено: ') + this.format(s.payoutUnits)
      : playing ? s.steps === 0 ? tr`Сделай первый ход. Ставка: ${this.format(s.stakeUnits)}`
        : tr`Ход ${s.steps}/${HILO_MAX_GUESSES} · Можно забрать ${this.format(s.payoutUnits)}` : translateText('Выбери ставку и начни партию.');
    let board = `<div class="casino-cards">${(s?.cards ?? []).map(card => `<div class="casino-card ${[1,2].includes(card.suit) ? 'red' : ''}"><b>${['','A','2','3','4','5','6','7','8','9','10','J','Q','K'][card.rank]}</b><span>${['♠','♥','♦','♣'][card.suit]}</span></div>`).join('') || '<div class="casino-card back">♛</div>'}</div>`;
    if (playing) board += `<div class="casino-directions">${(['higher','lower'] as const).map(direction => `<button data-pick="${direction}" ${blocked || !s.next?.[direction] ? 'disabled' : ''}>${direction === 'higher' ? translateText('Выше ↑') : translateText('Ниже ↓')}<small>${s.next?.[direction]?.toFixed(4) ?? translateText('Нет карт')}×</small></button>`).join('')}</div>`;
    this.host.innerHTML = tr`<section class="casino-session" aria-label="Hi-Lo"><div class="casino-controls"><label>Баланс для игры<select data-asset ${c.busy ? 'disabled' : ''}><option value="demo" selected>USDT · Демо</option></select></label><strong class="casino-balance">${wallet ? balance : translateText('Баланс загружается')}</strong><label>Ставка<select data-stake ${playing || blocked ? 'disabled' : ''}>${bets.map(b=>`<option value="${b}" ${b===this.stake?'selected':''}>${this.format(b)}</option>`).join('')}</select></label></div><div class="casino-board">${board}</div><p class="casino-status" role="status">${message}</p><div class="casino-actions">${playing?tr`<button data-cashout ${blocked || !s.steps || !ready?'disabled':''}>Забрать ${this.format(s.payoutUnits)}</button>`:tr`<button data-start ${blocked || !ready?'disabled':''}>Начать партию</button>`}${c.pending?tr`<button data-retry ${c.busy?'disabled':''}>Проверить ход</button>`:''}<button data-refresh ${c.busy?'disabled':''}>Обновить</button></div><p class="casino-error" role="alert">${escape(this.localError || c.error)}</p><details><summary>Правила и выплаты</summary><p>${translateText('Угадай, будет следующая карта выше или ниже. Туз имеет ранг 1. Одинаковые ранги проигрывают. Карты тянутся независимо. После первого удачного хода можно забрать выигрыш; после двух он начисляется автоматически.')} Коэффициент выплат: 99% от обратной вероятности успеха. Начисление округляется вниз до 0,01 USDT. Закрытие окна сохраняет активную партию.</p><a href="https://github.com/vafc21/Rush" target="_blank" rel="noopener noreferrer">Исходная математика Rush · MIT</a></details></section>`;
    decorateImportedGame(this.host.firstElementChild as HTMLElement, this.game);
    emitCardDealer(this.host,{gameId:this.game,account:(c.accountId??'')+':'+this.asset,sessionId:s?.id??'',phase:s?.steps??0,cards:JSON.stringify(s?.cards??[]),active:!!playing,busy:c.busy,pending:!!c.pending,spentUnits:s?.stakeUnits??'0',returnedUnits:s?.state==='cashed_out'?s.payoutUnits:'0'});
    this.host.querySelector<HTMLSelectElement>('[data-asset]')!.onchange = e => { this.asset = (e.target as HTMLSelectElement).value as CasinoAsset; this.stake = this.asset==='demo'?'1000':'1000000'; this.localError=''; this.render(); void casinoClients[this.asset].refresh(); };
    this.host.querySelector<HTMLSelectElement>('[data-stake]')!.onchange = e => { this.stake=(e.target as HTMLSelectElement).value; };
    this.host.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click',()=>void this.act({gameId:this.game,action:'start',stakeUnits:this.stake,settings:{}}));
    this.host.querySelector<HTMLButtonElement>('[data-cashout]')?.addEventListener('click',()=>void this.act({gameId:this.game,action:'cashout',sessionId:s!.id}));
    this.host.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b=>b.onclick=()=>void this.act({gameId:this.game,action:'pick',sessionId:s!.id,choice:b.dataset.pick as 'higher'|'lower'}));
    this.host.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click',()=>void c.retry().catch(()=>{}));
    this.host.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick=()=>{this.localError='';void c.refresh();};
  }
  destroy() { this.destroyed = true; resetGameOutcomes(this.host); for(const c of Object.values(casinoClients)) c.removeEventListener('change',this.change); this.host.replaceChildren(); }
}
