import { decorateImportedGame } from './ImportedGameThemes';
import { t as translateText, tr, locale, language } from '../i18n/index';
import { observeGameOutcome, resetGameOutcomes } from './gameReactions';
import { ConfirmedVisualMotion } from './ConfirmedVisualMotion';
import type { CasinoSession } from '../shared/casinoSessions';
import { casinoClients, type NewCasinoAction } from '../wallet/CasinoClient';
import { DEMO_BETS, type DemoWallet } from '../shared/demoWallet';
import { USDT_BETS, type UsdtWallet } from '../shared/usdtWallet';
import { HILO_MAX_GUESSES, type CasinoAsset, type SessionGameId, type TowerDifficulty } from '../shared/casinoSessions';
import { emitCardDealer } from './CardDealerStage';
import './casino-sessions.css';
const escape = (s: string) => translateText(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class CasinoSessionsUI {
  private destroyed = false;
  private motion?: ConfirmedVisualMotion;
  private motionEpoch = 0;
  private towerReactionFollow = false;
  private towerReactionOwner = '';
  private towerLive?: {account: string; asset: CasinoAsset; before?: CasinoSession; wallet?: DemoWallet | UsdtWallet; token: number; stage: 'waiting' | 'revealing'};
  private visibility = () => { if (document.hidden) { this.motion?.cancel(); this.towerLive = undefined; this.towerReactionFollow = false; resetGameOutcomes(this.host); this.render(); } };
  private asset: CasinoAsset = 'demo'; private stake = '1000'; private difficulty: TowerDifficulty = 'easy'; private localError = '';
  private change = () => {
    if (this.towerReactionFollow && this.towerReactionOwner !== (casinoClients[this.asset].accountId ?? '') + ':' + this.asset) { this.towerReactionFollow = false; resetGameOutcomes(this.host); }
    if (this.towerLive && (this.towerLive.account !== casinoClients[this.asset].accountId || this.towerLive.asset !== this.asset)) { this.motionEpoch++; this.motion?.cancel(); this.towerLive = undefined; this.towerReactionFollow = false; resetGameOutcomes(this.host); }
    this.render();
  };
  constructor(private host: HTMLElement, private game: SessionGameId) {
    resetGameOutcomes(host);
    if (game === 'github-tower') { this.motion = new ConfirmedVisualMotion(); document.addEventListener('visibilitychange', this.visibility); }
    for (const c of Object.values(casinoClients)) c.addEventListener('change', this.change);
    this.render(); void casinoClients.demo.refresh();
  }
  private format(units: string) {
    const n = BigInt(units), scale = this.asset === 'demo' ? 100n : 1000000n, decimals = this.asset === 'demo' ? 2 : 6;
    const fraction = (n % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return (n / scale).toLocaleString(locale) + (fraction ? (language === 'en' ? '.' : ',') + fraction : '') + (this.asset === 'demo' ? translateText(' монет') : ' USDT');
  }
  private async act(op: NewCasinoAction) {
    if (this.towerLive) return;
    const c = casinoClients[this.asset], account = c.accountId, asset = this.asset;
    this.localError = '';
    const current = c.sessions.find(value => value.gameId === this.game) ?? (c.last?.gameId === this.game ? c.last : undefined);
    const live = this.game === 'github-tower' && account && !c.pending && !document.hidden ? {account, asset, before: current ? structuredClone(current) : undefined, wallet: c.wallet ? structuredClone(c.wallet) : undefined, token: ++this.motionEpoch, stage: 'waiting' as 'waiting' | 'revealing'} : undefined;
    if (live) this.towerLive = live;
    if (this.game === 'github-tower') { this.towerReactionFollow = !!live; this.towerReactionOwner = (account ?? '') + ':' + asset; }
    try {
      await c.act(op);
      if (live && this.towerLive === live && !this.destroyed && c.accountId === account && asset === this.asset && !c.pending) {
        live.stage = 'revealing'; this.render();
        const nodes = op.action === 'pick' ? Array.from(this.host.querySelectorAll<HTMLElement>(`[data-cell="${live.before?.steps ?? 0}:${op.choice}"]`)) : op.action === 'cashout' ? Array.from(this.host.querySelectorAll<HTMLElement>('[data-cashout]')) : Array.from(this.host.querySelectorAll<HTMLElement>('[data-cell^="0:"]'));
        const completed = await this.motion!.run(nodes, op.action === 'start' ? 500 : 800, () => !this.destroyed && this.towerLive === live && c.accountId === account && this.asset === asset && !document.hidden, op.action === 'cashout' ? 'cashout' : 'cell');
        if (!completed) { this.towerReactionFollow = false; resetGameOutcomes(this.host); }
      }
    } catch (e) { if (this.game === 'github-tower') { this.towerReactionFollow = false; resetGameOutcomes(this.host); } if (!this.destroyed && c.accountId === account && this.asset === asset) this.localError = (e as Error).message; }
    if (this.towerLive === live) this.towerLive = undefined;
    this.render();
  }
  private render() {
    if (this.destroyed) return;
    if (this.towerLive?.stage === 'revealing' && this.host.querySelector<HTMLElement>('[data-tower-motion]')?.dataset.towerMotion === 'revealing') return;
    const c = casinoClients[this.asset], active = c.sessions.find(s => s.gameId === this.game), canonical = active ?? (c.last?.gameId === this.game ? c.last : undefined);
    const s = this.towerLive ? this.towerLive.before : canonical, wallet = this.towerLive?.wallet ?? c.wallet;
    const playing = s?.state === 'active', blocked = c.busy || c.loading || !!c.pending || !!this.towerLive;
    if (this.game !== 'github-tower') observeGameOutcome(this.host, { gameId: this.game, account: (c.accountId ?? '') + ':' + this.asset, sessionId: s?.id ?? '', active: !!playing, busy: c.busy, pending: c.pending?.gameId === this.game, spentUnits: s?.stakeUnits ?? '0', returnedUnits: s?.state === 'cashed_out' ? s.payoutUnits : '0' });
    if (playing) { this.stake = s.stakeUnits; if (s.difficulty) this.difficulty = s.difficulty; }
    const real = this.asset === 'usdt' ? wallet as UsdtWallet | undefined : undefined;
    const ready = !!c.accountId && !!wallet && (this.asset === 'demo' || real?.state === 'assigned' && real.ready);
    const balance = this.asset === 'demo' ? (wallet as DemoWallet | undefined)?.balance.toLocaleString(locale) + translateText(' монет')
      : real?.state === 'assigned' ? this.format(real.balanceUnits) : translateText('Недоступен');
    const bets = this.asset === 'demo' ? DEMO_BETS.map(n => String(n * 100)) : [...USDT_BETS];
    const message = this.towerLive ? this.towerLive.stage === 'waiting' ? translateText('Подтверждаем ход…') : translateText('Показываем подтверждённый ход…') : !c.accountId ? translateText('Войди в аккаунт, чтобы делать ставки.') : c.loading ? translateText('Обновляем баланс и партию…')
      : this.asset === 'usdt' && !ready ? translateText('Денежный кошелёк пока недоступен для этого аккаунта. Проверь его в разделе USDT.')
      : s?.state === 'lost' ? translateText('Ставка проиграна.') : s?.state === 'cashed_out' ? translateText('Начислено: ') + this.format(s.payoutUnits)
      : playing ? s.steps === 0 ? tr`Сделай первый ход. Ставка: ${this.format(s.stakeUnits)}`
        : tr`Ход ${s.steps}${this.game === 'github-hilo' ? '/' + HILO_MAX_GUESSES : '/9'} · Можно забрать ${this.format(s.payoutUnits)}` : translateText('Выбери ставку и начни партию.');
    let board = '';
    if (this.game === 'github-hilo') {
      board = `<div class="casino-cards">${(s?.cards ?? []).map(card => `<div class="casino-card ${[1,2].includes(card.suit) ? 'red' : ''}"><b>${['','A','2','3','4','5','6','7','8','9','10','J','Q','K'][card.rank]}</b><span>${['♠','♥','♦','♣'][card.suit]}</span></div>`).join('') || '<div class="casino-card back">♛</div>'}</div>`;
      if (playing) board += `<div class="casino-directions">${(['higher','lower'] as const).map(direction => `<button data-pick="${direction}" ${blocked || !s.next?.[direction] ? 'disabled' : ''}>${direction === 'higher' ? translateText('Выше ↑') : translateText('Ниже ↓')}<small>${s.next?.[direction]?.toFixed(4) ?? translateText('Нет карт')}×</small></button>`).join('')}</div>`;
    } else {
      const columns = s?.columns ?? ({easy:4,medium:3,hard:2} as const)[this.difficulty];
      board = `<div class="casino-tower" style="--columns:${columns}">${Array.from({length:9}, (_, i) => 8-i).map(row => `<div class="casino-row"><span>${row+1}</span>${Array.from({length:columns},(_,col)=>tr`<button data-cell="${row}:${col}" aria-label="Уровень ${row+1}, клетка ${col+1}" ${!playing || blocked || row !== s.steps ? 'disabled' : ''} class="${s?.revealed?.[row] === col ? 'chosen' : ''} ${s?.dragons?.[row] === col ? 'dragon' : ''}">${s?.dragons?.[row] === col ? '✹' : s?.revealed?.[row] === col ? '◆' : '·'}</button>`).join('')}</div>`).join('')}</div>`;
    }
    this.host.innerHTML = tr`<section class="casino-session" data-tower-motion="${this.towerLive?.stage ?? 'static'}" aria-label="${this.game === 'github-hilo' ? 'Hi-Lo' : 'Dragon Tower'}"><div class="casino-controls"><label>Баланс для игры<select data-asset ${c.busy || this.towerLive ? 'disabled' : ''}><option value="demo" ${this.asset==='demo'?'selected':''}>Демомонеты</option><option value="usdt" ${this.asset==='usdt'?'selected':''}>Настоящие USDT</option></select></label><strong class="casino-balance">${wallet ? balance : translateText('Баланс загружается')}</strong><label>Ставка<select data-stake ${playing || blocked ? 'disabled' : ''}>${bets.map(b=>`<option value="${b}" ${b===this.stake?'selected':''}>${this.format(b)}</option>`).join('')}</select></label>${this.game==='github-tower'?tr`<label>Сложность<select data-difficulty ${playing || blocked?'disabled':''}>${(['easy','medium','hard'] as const).map(d=>`<option value="${d}" ${(s?.state==='active'?s.difficulty:this.difficulty)===d?'selected':''}>${{easy:translateText('Лёгкая: 4 клетки'),medium:translateText('Средняя: 3 клетки'),hard:translateText('Сложная: 2 клетки')}[d]}</option>`).join('')}</select></label>`:''}</div><div class="casino-board">${board}</div><p class="casino-status" role="status">${message}</p><div class="casino-actions">${playing?tr`<button data-cashout ${blocked || !s.steps || !ready?'disabled':''}>Забрать ${this.format(s.payoutUnits)}</button>`:tr`<button data-start ${blocked || !ready?'disabled':''}>Начать партию</button>`}${c.pending?tr`<button data-retry ${c.busy?'disabled':''}>Проверить ход</button>`:''}<button data-refresh ${c.busy || this.towerLive?'disabled':''}>Обновить</button></div><p class="casino-error" role="alert">${escape(this.localError || c.error)}</p><details><summary>Правила и выплаты</summary><p>${this.game==='github-hilo'?translateText('Угадай, будет следующая карта выше или ниже. Туз имеет ранг 1. Одинаковые ранги проигрывают. Карты тянутся независимо. После первого удачного хода можно забрать выигрыш; после двух он начисляется автоматически.'):translateText('Поднимайся по девяти уровням. На каждом одна клетка с драконом, остальные выигрышные. После удачного выбора можно забрать выплату. Дракон завершает партию с потерей ставки; девятый уровень выплачивается автоматически.')} Коэффициент выплат: 99% от обратной вероятности успеха. Начисление округляется вниз до сотой демомонеты или миллионной USDT. Закрытие окна сохраняет активную партию.</p><a href="https://github.com/vafc21/Rush" target="_blank" rel="noopener noreferrer">Исходная математика Rush · MIT</a></details></section>`;
    decorateImportedGame(this.host.firstElementChild as HTMLElement, this.game);
    if(this.game==='github-hilo')emitCardDealer(this.host,{gameId:this.game,account:(c.accountId??'')+':'+this.asset,sessionId:s?.id??'',phase:s?.steps??0,cards:JSON.stringify(s?.cards??[]),active:!!playing,busy:c.busy,pending:!!c.pending,spentUnits:s?.stakeUnits??'0',returnedUnits:s?.state==='cashed_out'?s.payoutUnits:'0'});
    if (this.game === 'github-tower') observeGameOutcome(this.host, { gameId: this.game, account: (c.accountId ?? '') + ':' + this.asset, sessionId: s?.id ?? '', active: !!playing, busy: c.busy || !!this.towerLive || !this.towerReactionFollow || document.hidden, pending: c.pending?.gameId === this.game && this.towerReactionFollow, spentUnits: s?.stakeUnits ?? '0', returnedUnits: s?.state === 'cashed_out' ? s.payoutUnits : '0' });
    this.host.querySelector<HTMLSelectElement>('[data-asset]')!.onchange = e => { this.asset = (e.target as HTMLSelectElement).value as CasinoAsset; this.stake = this.asset==='demo'?'1000':'1000000'; this.localError=''; if(this.game==='github-tower'){this.towerReactionFollow=false;resetGameOutcomes(this.host);} this.render(); void casinoClients[this.asset].refresh(); };
    this.host.querySelector<HTMLSelectElement>('[data-stake]')!.onchange = e => { this.stake=(e.target as HTMLSelectElement).value; };
    const difficulty=this.host.querySelector<HTMLSelectElement>('[data-difficulty]'); if(difficulty) difficulty.onchange=e=>{this.difficulty=(e.target as HTMLSelectElement).value as TowerDifficulty;this.render();};
    this.host.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click',()=>void this.act({gameId:this.game,action:'start',stakeUnits:this.stake,settings:this.game==='github-tower'?{difficulty:this.difficulty}:{}}));
    this.host.querySelector<HTMLButtonElement>('[data-cashout]')?.addEventListener('click',()=>void this.act({gameId:this.game,action:'cashout',sessionId:s!.id}));
    this.host.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b=>b.onclick=()=>void this.act({gameId:this.game,action:'pick',sessionId:s!.id,choice:b.dataset.pick as 'higher'|'lower'}));
    this.host.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(b=>b.onclick=()=>void this.act({gameId:this.game,action:'pick',sessionId:s!.id,choice:Number(b.dataset.cell!.split(':')[1])}));
    this.host.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click',()=>{if(this.game==='github-tower'){this.towerReactionFollow=false;resetGameOutcomes(this.host);}void c.retry().catch(()=>{});});
    this.host.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick=()=>{this.localError='';if(this.game==='github-tower'){this.towerReactionFollow=false;resetGameOutcomes(this.host);}void c.refresh();};
  }
  destroy() { this.destroyed = true; this.motionEpoch++; this.motion?.destroy(); document.removeEventListener('visibilitychange', this.visibility); this.towerLive = undefined; this.towerReactionFollow = false; resetGameOutcomes(this.host); for(const c of Object.values(casinoClients)) c.removeEventListener('change',this.change); this.host.replaceChildren(); }
}
