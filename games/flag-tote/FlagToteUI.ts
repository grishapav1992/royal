import { FLAG_COUNTRIES, type FlagCountry, type FlagView } from '../../src/shared/flagBattle';
import { TOTE_STAKES, type ToteRound } from '../../src/shared/flagTote';
import { flagToteClient as client } from '../../src/wallet/FlagToteClient';
import { demoWallet } from '../../src/wallet/WalletClient';
import { language } from '../../src/i18n/index';
import { FlagArena, flagAsset } from '../flag-battle/FlagArena';
import { FlagAudio } from '../flag-battle/FlagAudio';

const en = language === 'en';
const tr = (ru: string, english: string) => en ? english : ru;
const countryName = (id: string) => { const c = FLAG_COUNTRIES.find(c => c.id === id); return c ? en ? c.en : c.ru : id; };
const money = (units: string | number) => (Number(units) / 100).toLocaleString(en ? 'en-US' : 'ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export class FlagToteUI {
  private root = document.createElement('section');
  private arena: FlagArena;
  private audio = new FlagAudio();
  private lifetime = new AbortController();
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private unsubscribe: () => void;
  private selected: FlagCountry = 'RU';
  private stake = '100';
  private seen = '';
  private frame = 0;
  private lastPaint = 0;
  private round?: ToteRound;
  private raceStarted = false;
  private audioStarted = false;
  private owner = client.accountId;
  private resultKey = '';
  private receiptKey = '';
  constructor(host: HTMLElement) {
    this.root.className = 'ft-root';
    this.root.innerHTML = `<header class="ft-header"><div><span class="ft-eyebrow">ROYAL / COMMUNITY ARENA</span><h2>${tr('Флаговый тотализатор','Flag totalizator')}</h2><p>${tr('48 стран. Один общий банк.','48 countries. One shared pool.')}</p></div><button type="button" data-ft="rules">${tr('Правила','Rules')} ↗</button></header>
<div class="ft-layout"><div class="ft-main"><div class="ft-board"><div class="ft-board-top"><span data-ft="phase"></span><b data-ft="count">48 / 48</b></div><canvas aria-label="${tr('Общая арена 48 флагов','Shared arena of 48 flags')}"></canvas><div class="ft-moment"><small data-ft="round"></small><strong data-ft="headline"></strong><span data-ft="subline"></span></div></div><div class="ft-results" data-ft="results" role="status"></div><div class="ft-receipts"><h3>${tr('Твои ставки в этом раунде','Your tickets in this round')}</h3><div data-ft="receipts"></div></div><details class="ft-history"><summary>${tr('Последние раунды','Recent rounds')}</summary><div data-ft="history"></div></details></div>
<aside class="ft-controls"><div class="ft-organiser"><div class="ft-avatar" aria-hidden="true">♜</div><div><small>${tr('РАСПОРЯДИТЕЛЬ АРЕНЫ','ARENA ORGANISER')}</small><p data-ft="organiser"></p></div></div><div class="ft-pool"><span>${tr('Общий банк','Shared pool')}</span><strong data-ft="bank">0,00</strong><small>USDT · ${tr('Демо','Demo')} · ${tr('Игроков','Players')}: <span data-ft="people">0</span></small></div><div class="ft-minimum" data-ft="minimum"></div><label class="ft-label" for="ft-search">${tr('Выбери страну','Choose a country')}<input id="ft-search" type="search" placeholder="${tr('Название или код страны','Country name or code')}"></label><div class="ft-countries">${FLAG_COUNTRIES.map(c => `<button type="button" data-country="${c.id}" aria-pressed="false"><img src="${flagAsset(c.id)}" alt=""><span>${countryName(c.id)}</span><small data-total="${c.id}">0,00</small></button>`).join('')}</div><p data-ft="empty" hidden>${tr('Страна не найдена.','No matching country.')}</p><label class="ft-label" for="ft-stake">${tr('Сумма ставки','Stake')}<select id="ft-stake">${TOTE_STAKES.map(s => `<option value="${s}">${money(s)} USDT</option>`).join('')}</select></label><div class="ft-quote"><span>${tr('Если страна займёт первое место','If this country finishes first')}</span><b data-ft="quote"></b><small>${tr('Предполагаемая выплата включает ставку и меняется до закрытия приёма.','Indicative return includes the stake and changes until betting closes.')}</small></div><button class="ft-bet" type="button" data-ft="bet">${tr('Поставить','Place bet')}</button><button class="ft-retry" type="button" data-ft="retry" hidden>${tr('Проверить ту же ставку','Check the same bet')}</button><p class="ft-status" data-ft="status" aria-live="polite"></p><p class="ft-note">${tr('Комиссия 5%. Если победитель без ставок: три лучшие страны со ставками делят остаток 60 / 30 / 10.','5% fee. If the winner is unbacked, the three best backed countries split the remainder 60 / 30 / 10.')}<br>${tr('Шанс первого места каждой страны: 1 из 48.','Each country has a 1 in 48 chance of first place.')}</p></aside></div>
<dialog class="ft-rules"><h3>${tr('Общий тотализатор','Shared totalizator')}</h3><p>${tr('В каждом раунде участвуют все 48 стран, даже без ставок. Ставки игроков образуют общий банк. Можно поддержать несколько стран и добавлять ставки до закрытия приёма.','Every round includes all 48 countries, even unbacked ones. Player stakes form one pool. You can back several countries and add tickets until betting closes.')}</p><p>${tr('Если победившая страна поддержана ставками, её игроки делят 95% банка. Если на победителя ставок нет, находим три лучшие страны со ставками: 60%, 30% и 10% от оставшихся после комиссии 95%. Внутри страны выплата пропорциональна взносу. Округление распределяет все копейки, равные остатки получают более ранние билеты.','If the winning country is backed, its supporters split 95% of the bank. Otherwise the three best backed countries receive 60%, 30% and 10% of that 95%. Each country award is shared in proportion to accepted stakes. Integer rounding assigns every cent, with earlier tickets breaking ties.')}</p><p>${tr('Для старта нужны минимум три страны со ставками и два игрока. Иначе все взносы возвращаются без комиссии. Выход из игры не отменяет принятую ставку. После закрытия приёма ставки не меняются. При разрыве связи проверь тот же билет.','Starting requires at least three backed countries and two players. Otherwise every stake is refunded without a fee. Leaving does not cancel an accepted ticket. Bets cannot change after the cutoff. If disconnected, check the same ticket.')}</p><p>${tr('Банк до 10 000 USDT, до 256 билетов, сумма ставок одного игрока до 500 USDT за раунд. Выплата может быть меньше ставки: это отрицательный итог. Индивидуальная ожидаемая выплата зависит от распределения ставок, фиксированного RTP игрока здесь нет.','Pool limit: 10,000 USDT, 256 tickets and 500 USDT per account per round. A return below your stake is a net loss. Individual expectation depends on the allocation of stakes; there is no fixed player RTP.')}</p><button type="button" data-ft="close-rules">${tr('Понятно','Got it')}</button></dialog>`;
    host.replaceChildren(this.root); this.arena = new FlagArena(this.find('canvas')); this.arena.reset(undefined, 'world');
    const signal = this.lifetime.signal;
    this.root.addEventListener('pointerdown', () => { void this.audio.unlock(); }, { signal });
    this.root.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!b) return;
      if (b.dataset.country) { this.selected = b.dataset.country as FlagCountry; this.render(); }
      if (b.dataset.ft === 'bet') void this.send(false);
      if (b.dataset.ft === 'retry') void this.send(true);
      if (b.dataset.ft === 'rules') this.find<HTMLDialogElement>('dialog').showModal();
      if (b.dataset.ft === 'close-rules') this.find<HTMLDialogElement>('dialog').close();
    }, { signal });
    this.find<HTMLInputElement>('#ft-search').addEventListener('input', () => this.filter(), { signal });
    this.find<HTMLSelectElement>('#ft-stake').addEventListener('change', e => { this.stake = (e.target as HTMLSelectElement).value; this.render(); }, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.audio.silence(); else void client.refresh(); }, { signal });
    this.motion.addEventListener('change', () => { this.audio.silence(); }, { signal });
    this.unsubscribe = client.subscribe(() => this.sync());
    demoWallet.addEventListener('change', () => this.render(), { signal }); this.sync(); this.frame = requestAnimationFrame(t => this.tick(t));
  }
  private find<T extends Element = HTMLElement>(s: string): T { return this.root.querySelector<T>(s)!; }
  private put(key: string, value: string) { this.find(`[data-ft="${key}"]`).textContent = value; }
  private sync() {
    if (this.owner !== client.accountId) { this.owner = client.accountId; this.audio.silence(); this.seen = ''; this.round = undefined; this.selected = 'RU'; this.stake = '100'; this.arena.reset(undefined, 'world'); }
    const previous = this.round;
    const r = client.snapshot?.round;
    if (r) {
      this.round = r;
      const key = r.id + (r.order ? ':race' : ':open');
      if (key !== this.seen) {
        const wasOpen = this.seen === r.id + ':open';
        this.seen = key; this.audio.silence(); this.raceStarted = wasOpen && r.state === 'racing'; this.audioStarted = false;
        const view: FlagView | undefined = r.order ? { version: 2, mode: 'world', country: this.selected, order: r.order, seed: r.seed! } : undefined;
        this.arena.reset(view, 'world');
      }
    }
    if (r?.state === 'settled' && previous?.id === r.id && previous.state === 'racing' && !document.hidden) {
      const mine = client.snapshot!.tickets.filter(t => t.roundId === r.id);
      const spent = mine.reduce((n, t) => n + Number(t.stakeUnits), 0), paid = mine.reduce((n, t) => n + Number(t.payoutUnits ?? 0), 0);
      if (spent) this.audio.instantResult(r.id + ':result', paid > spent);
    }
    this.render();
  }
  private filter() {
    const q = this.find<HTMLInputElement>('#ft-search').value.trim().toLocaleLowerCase(); let n = 0;
    this.root.querySelectorAll<HTMLButtonElement>('[data-country]').forEach(b => { b.hidden = !`${countryName(b.dataset.country!)} ${b.dataset.country}`.toLocaleLowerCase().includes(q); if (!b.hidden) n++; });
    this.find('[data-ft="empty"]').hidden = n > 0;
  }
  private render() {
    if (this.lifetime.signal.aborted) return;
    const r = this.round, now = client.serverTime(), accepting = r?.state === 'open' && now < r.closesAt;
    const blocked = client.busy || !!client.pending || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('flag-tote');
    this.root.querySelectorAll<HTMLButtonElement>('[data-country]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.country === this.selected)); });
    this.put('bank', money(r?.potUnits ?? '0')); this.put('people', String(r?.participants ?? 0));
    const backed = r?.totals.filter(t => Number(t.units) > 0).length ?? 0;
    this.put('minimum', tr(`Стран со ставками: ${backed} / минимум 3 · игроков: ${r?.participants ?? 0} / минимум 2`, `Backed countries: ${backed} / minimum 3 · players: ${r?.participants ?? 0} / minimum 2`));
    for (const t of r?.totals ?? []) this.find(`[data-total="${t.country}"]`).textContent = money(t.units);
    this.put('phase', !r ? tr('ПОДКЛЮЧЕНИЕ','CONNECTING') : accepting ? tr('ПРИЁМ СТАВОК','BETTING OPEN') : r?.state === 'racing' ? tr('БИТВА ИДЁТ','RACE IN PROGRESS') : tr('РЕЗУЛЬТАТЫ','RESULTS'));
    const remaining = accepting ? Math.max(0, Math.ceil((r!.closesAt - now) / 1000)) : 0;
    this.put('round', r ? `${tr('Раунд','Round')} #${Math.floor(r.openedAt / 300000)}` : tr('Общий раунд','Shared round'));
    this.put('headline', !r ? tr('Загружаем раунд…','Loading round…') : accepting ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2,'0')}` : r?.state === 'refunded' ? tr('Ставки возвращены','Stakes refunded') : r?.order && r.state === 'settled' ? countryName(r.order.at(-1)!) : tr('48 флагов на арене','48 flags in the arena'));
    this.put('subline', accepting ? tr('До закрытия ставок','Until betting closes') : r?.state === 'refunded' ? tr('Не набралось участников для старта','Not enough participants to start') : tr('Приём ставок завершён','Betting is closed'));
    this.put('organiser', !r ? tr('Проверяю общий банк…','Checking the shared pool…') : accepting ? tr('Выбирай флаг. Все смотрят один раунд.','Pick your flag. Everyone shares this round.') : tr('Раунд сохранён. Выплаты придут автоматически.','The round is saved. Awards arrive automatically.'));
    const selectedTotal = Number(r?.totals.find(t => t.country === this.selected)?.units ?? 0);
    const quote = r ? (Number(r.potUnits) + Number(this.stake)) * .95 * Number(this.stake) / (selectedTotal + Number(this.stake)) : 0;
    this.put('quote', accepting ? `≈ ${money(Math.floor(quote))} USDT` : tr('Приём закрыт','Betting closed'));
    this.find<HTMLButtonElement>('[data-ft="bet"]').disabled = !accepting || blocked || !client.accountId;
    this.find<HTMLButtonElement>('[data-ft="bet"]').textContent = client.busy ? tr('Проверяем ставку…','Checking ticket…') : `${tr('Поставить','Back')}: ${countryName(this.selected)} · ${money(this.stake)}`;
    this.find<HTMLSelectElement>('select').disabled = !accepting || blocked;
    this.find<HTMLButtonElement>('[data-ft="retry"]').hidden = !client.pending; this.find<HTMLButtonElement>('[data-ft="retry"]').disabled = client.busy;
    this.put('status', client.error || (!client.accountId ? tr('Войди в аккаунт для участия.','Sign in to participate.') : client.pending ? tr('Проверь отправленный билет перед новой ставкой.','Check your sent ticket before placing another.') : tr('Все ставки идут в общий банк игроков.','All stakes go into the shared player pool.')));
    const mine = client.snapshot?.tickets.filter(t => t.roundId === r?.id) ?? [];
    const receiptKey = JSON.stringify(mine);
    if (receiptKey !== this.receiptKey) { this.receiptKey = receiptKey; this.find('[data-ft="receipts"]').innerHTML = mine.length ? mine.map(t => `<div class="ft-ticket"><img src="${flagAsset(t.country)}" alt=""><span>${countryName(t.country)}<small>${tr('Ставка','Stake')}: ${money(t.stakeUnits)} · ${t.id.slice(0,8)}</small></span><b>${t.payoutUnits === null ? tr('Принята','Accepted') : `${tr('Возврат','Return')}: ${money(t.payoutUnits)}`}</b></div>`).join('') : `<p>${tr('Ты можешь смотреть без ставки.','You can watch without betting.')}</p>`;
    }
    const result = this.find('[data-ft="results"]');
    const resultKey = JSON.stringify([r?.id, r?.settlement, mine]);
    if (resultKey !== this.resultKey) { this.resultKey = resultKey; result.replaceChildren();
    if (r?.settlement) {
      const s = r.settlement, spent = mine.reduce((n,t)=>n+Number(t.stakeUnits),0), paid = mine.reduce((n,t)=>n+Number(t.payoutUnits ?? 0),0);
      const title = document.createElement('h3'); title.textContent = s.state === 'refunded' ? tr('Полный возврат без комиссии','Full refund, no fee') : s.awards.length === 3 ? tr('Победитель без ставок: выплаты ближайшим странам','Unbacked winner: awards to the nearest backed countries') : tr('Победитель делит банк','The winner shares the pool'); result.append(title);
      for (const a of s.awards) { const p = document.createElement('p'); p.textContent = `#${a.place} ${countryName(a.country)} · ${money(a.units)} USDT`; result.append(p); }
      if (spent) { const p = document.createElement('p'); p.className = 'ft-personal'; p.textContent = `${tr('Твои ставки','Your stakes')}: ${money(spent)} · ${tr('Выплата','Return')}: ${money(paid)} · ${tr('Итог','Net')}: ${paid - spent > 0 ? '+' : ''}${money(paid - spent)} USDT`; result.append(p); }
    }
    }
    this.find('[data-ft="history"]').innerHTML = (client.snapshot?.history ?? []).map(h => `<p>#${Math.floor(h.openedAt / 300000)} · ${h.state === 'refunded' ? tr('Возврат','Refund') : h.order ? countryName(h.order.at(-1)!) : tr('Ожидание','Pending')} · ${tr('Банк','Pool')}: ${money(h.potUnits)} USDT</p>`).join('');
    this.filter();
  }
  private async send(retry: boolean) {
    try { const reply = await (retry ? client.retry() : client.bet(this.selected, this.stake)); if (!this.lifetime.signal.aborted && !document.hidden && !reply.replayed) { await this.audio.unlock(); if (!this.lifetime.signal.aborted) this.audio.cue('select'); } }
    catch (e) { if (!this.lifetime.signal.aborted) this.put('status', e instanceof Error ? e.message : tr('Проверь отправленную ставку.','Check your submitted ticket.')); }
  }
  private tick(t: number) {
    const r = this.round;
    if (r?.order) {
      const elapsed = Math.max(0, (client.serverTime() - r.closesAt) / 1000);
      this.arena.seek(this.motion.matches || r.state === 'settled' ? 31 : elapsed);
      if (this.raceStarted && !this.audioStarted && !document.hidden && !this.motion.matches) {
        this.audioStarted = true;
        this.audio.begin(r.id, this.arena.soundTimeline(this.selected, false).filter(e => !['win','lose'].includes(e.cue)));
      }
      if (!document.hidden && !this.motion.matches) this.audio.advance(elapsed, t);
    }
    const state = this.arena.tick(t, false, this.selected, !this.motion.matches);
    this.put('count', `${48 - state.eliminated} / 48`);
    if (t - this.lastPaint > 1000) { this.lastPaint = t; this.render(); }
    this.frame = requestAnimationFrame(time => this.tick(time));
  }
  getState() { return { roundId: this.round?.id, state: this.round?.state, accountId: client.accountId, pending: client.pending?.id, physics: this.arena.getState(), audio: this.audio.state() }; }
  pause() { this.audio.silence(); }
  resume() { void client.refresh(); }
  destroy() { this.lifetime.abort(); this.unsubscribe(); cancelAnimationFrame(this.frame); this.audio.destroy(); this.root.remove(); }
}
