import { casinoClients, type NewCasinoAction } from '../wallet/CasinoClient';
import { DEMO_BETS, type DemoWallet } from '../shared/demoWallet';
import { USDT_BETS, type UsdtWallet } from '../shared/usdtWallet';
import { HILO_MAX_GUESSES, type CasinoAsset, type SessionGameId, type TowerDifficulty } from '../shared/casinoSessions';
import './casino-sessions.css';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class CasinoSessionsUI {
  private destroyed = false;
  private asset: CasinoAsset = 'demo'; private stake = '1000'; private difficulty: TowerDifficulty = 'easy'; private localError = '';
  private change = () => this.render();
  constructor(private host: HTMLElement, private game: SessionGameId) {
    for (const c of Object.values(casinoClients)) c.addEventListener('change', this.change);
    this.render(); void casinoClients.demo.refresh();
  }
  private format(units: string) {
    const n = BigInt(units), scale = this.asset === 'demo' ? 100n : 1000000n, decimals = this.asset === 'demo' ? 2 : 6;
    const fraction = (n % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return (n / scale).toLocaleString('ru-RU') + (fraction ? ',' + fraction : '') + (this.asset === 'demo' ? ' монет' : ' USDT');
  }
  private async act(op: NewCasinoAction) { this.localError = ''; try { await casinoClients[this.asset].act(op); } catch (e) { this.localError = (e as Error).message; } this.render(); }
  private render() {
    if (this.destroyed) return;
    const c = casinoClients[this.asset], active = c.sessions.find(s => s.gameId === this.game), s = active ?? (c.last?.gameId === this.game ? c.last : undefined);
    const playing = s?.state === 'active', blocked = c.busy || c.loading || !!c.pending;
    if (playing) { this.stake = s.stakeUnits; if (s.difficulty) this.difficulty = s.difficulty; }
    const real = this.asset === 'usdt' ? c.wallet as UsdtWallet | undefined : undefined;
    const ready = !!c.accountId && !!c.wallet && (this.asset === 'demo' || real?.state === 'assigned' && real.ready);
    const balance = this.asset === 'demo' ? (c.wallet as DemoWallet | undefined)?.balance.toLocaleString('ru-RU') + ' монет'
      : real?.state === 'assigned' ? this.format(real.balanceUnits) : 'Недоступен';
    const bets = this.asset === 'demo' ? DEMO_BETS.map(n => String(n * 100)) : [...USDT_BETS];
    const message = !c.accountId ? 'Войди в аккаунт, чтобы делать ставки.' : c.loading ? 'Обновляем баланс и партию…'
      : this.asset === 'usdt' && !ready ? 'Денежный кошелёк пока недоступен для этого аккаунта. Проверь его в разделе USDT.'
      : s?.state === 'lost' ? 'Ставка проиграна.' : s?.state === 'cashed_out' ? 'Начислено: ' + this.format(s.payoutUnits)
      : playing ? s.steps === 0 ? `Сделай первый ход. Ставка: ${this.format(s.stakeUnits)}`
        : `Ход ${s.steps}${this.game === 'github-hilo' ? '/' + HILO_MAX_GUESSES : '/9'} · Можно забрать ${this.format(s.payoutUnits)}` : 'Выбери ставку и начни партию.';
    let board = '';
    if (this.game === 'github-hilo') {
      board = `<div class="casino-cards">${(s?.cards ?? []).map(card => `<div class="casino-card ${[1,2].includes(card.suit) ? 'red' : ''}"><b>${['','A','2','3','4','5','6','7','8','9','10','J','Q','K'][card.rank]}</b><span>${['♠','♥','♦','♣'][card.suit]}</span></div>`).join('') || '<div class="casino-card back">♛</div>'}</div>`;
      if (playing) board += `<div class="casino-directions">${(['higher','lower'] as const).map(direction => `<button data-pick="${direction}" ${blocked || !s.next?.[direction] ? 'disabled' : ''}>${direction === 'higher' ? 'Выше ↑' : 'Ниже ↓'}<small>${s.next?.[direction]?.toFixed(4) ?? 'Нет карт'}×</small></button>`).join('')}</div>`;
    } else {
      const columns = s?.columns ?? ({easy:4,medium:3,hard:2} as const)[this.difficulty];
      board = `<div class="casino-tower" style="--columns:${columns}">${Array.from({length:9}, (_, i) => 8-i).map(row => `<div class="casino-row"><span>${row+1}</span>${Array.from({length:columns},(_,col)=>`<button data-cell="${row}:${col}" aria-label="Уровень ${row+1}, клетка ${col+1}" ${!playing || blocked || row !== s.steps ? 'disabled' : ''} class="${s?.revealed?.[row] === col ? 'chosen' : ''} ${s?.dragons?.[row] === col ? 'dragon' : ''}">${s?.dragons?.[row] === col ? '✹' : s?.revealed?.[row] === col ? '◆' : '·'}</button>`).join('')}</div>`).join('')}</div>`;
    }
    this.host.innerHTML = `<section class="casino-session" aria-label="${this.game === 'github-hilo' ? 'Hi-Lo' : 'Dragon Tower'}"><div class="casino-controls"><label>Баланс для игры<select data-asset ${c.busy ? 'disabled' : ''}><option value="demo" ${this.asset==='demo'?'selected':''}>Демомонеты</option><option value="usdt" ${this.asset==='usdt'?'selected':''}>Настоящие USDT</option></select></label><strong class="casino-balance">${c.wallet ? balance : 'Баланс загружается'}</strong><label>Ставка<select data-stake ${playing || blocked ? 'disabled' : ''}>${bets.map(b=>`<option value="${b}" ${b===this.stake?'selected':''}>${this.format(b)}</option>`).join('')}</select></label>${this.game==='github-tower'?`<label>Сложность<select data-difficulty ${playing || blocked?'disabled':''}>${(['easy','medium','hard'] as const).map(d=>`<option value="${d}" ${(s?.state==='active'?s.difficulty:this.difficulty)===d?'selected':''}>${{easy:'Лёгкая: 4 клетки',medium:'Средняя: 3 клетки',hard:'Сложная: 2 клетки'}[d]}</option>`).join('')}</select></label>`:''}</div><div class="casino-board">${board}</div><p class="casino-status" role="status">${message}</p><div class="casino-actions">${playing?`<button data-cashout ${blocked || !s.steps || !ready?'disabled':''}>Забрать ${this.format(s.payoutUnits)}</button>`:`<button data-start ${blocked || !ready?'disabled':''}>Начать партию</button>`}${c.pending?`<button data-retry ${c.busy?'disabled':''}>Проверить ход</button>`:''}<button data-refresh ${c.busy?'disabled':''}>Обновить</button></div><p class="casino-error" role="alert">${escape(this.localError || c.error)}</p><details><summary>Правила и выплаты</summary><p>${this.game==='github-hilo'?'Угадай, будет следующая карта выше или ниже. Туз имеет ранг 1. Одинаковые ранги проигрывают. Карты тянутся независимо. После первого удачного хода можно забрать выигрыш; после двух он начисляется автоматически.':'Поднимайся по девяти уровням. На каждом одна клетка с драконом, остальные выигрышные. После удачного выбора можно забрать выплату. Дракон завершает партию с потерей ставки; девятый уровень выплачивается автоматически.'} Коэффициент выплат: 99% от обратной вероятности успеха. Начисление округляется вниз до сотой демомонеты или миллионной USDT. Закрытие окна сохраняет активную партию.</p><a href="https://github.com/vafc21/Rush" target="_blank" rel="noopener noreferrer">Исходная математика Rush · MIT</a></details></section>`;
    this.host.querySelector<HTMLSelectElement>('[data-asset]')!.onchange = e => { this.asset = (e.target as HTMLSelectElement).value as CasinoAsset; this.stake = this.asset==='demo'?'1000':'1000000'; this.localError=''; this.render(); void casinoClients[this.asset].refresh(); };
    this.host.querySelector<HTMLSelectElement>('[data-stake]')!.onchange = e => { this.stake=(e.target as HTMLSelectElement).value; };
    const difficulty=this.host.querySelector<HTMLSelectElement>('[data-difficulty]'); if(difficulty) difficulty.onchange=e=>{this.difficulty=(e.target as HTMLSelectElement).value as TowerDifficulty;this.render();};
    this.host.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click',()=>void this.act({gameId:this.game,action:'start',stakeUnits:this.stake,settings:this.game==='github-tower'?{difficulty:this.difficulty}:{}}));
    this.host.querySelector<HTMLButtonElement>('[data-cashout]')?.addEventListener('click',()=>void this.act({gameId:this.game,action:'cashout',sessionId:s!.id}));
    this.host.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b=>b.onclick=()=>void this.act({gameId:this.game,action:'pick',sessionId:s!.id,choice:b.dataset.pick as 'higher'|'lower'}));
    this.host.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(b=>b.onclick=()=>void this.act({gameId:this.game,action:'pick',sessionId:s!.id,choice:Number(b.dataset.cell!.split(':')[1])}));
    this.host.querySelector<HTMLButtonElement>('[data-retry]')?.addEventListener('click',()=>void c.retry().catch(()=>{}));
    this.host.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick=()=>{this.localError='';void c.refresh();};
  }
  destroy() { this.destroyed = true; for(const c of Object.values(casinoClients)) c.removeEventListener('change',this.change); this.host.replaceChildren(); }
}
