import { FLAG_GAME, FLAG_BETS, FLAG_COUNTRIES, FLAG_MODES, flagCountries, flagModeInfo, flagViewMode, flagPayout, validFlagSettings, type FlagMode, type FlagCountry, type FlagView } from '../../src/shared/flagBattle';
import { expansionClient as client } from '../../src/wallet/ExpansionClient';
import { demoWallet } from '../../src/wallet/WalletClient';
import { FlagAudio } from './FlagAudio';
import { language } from '../../src/i18n/index';
import { FlagArena, flagAsset } from './FlagArena';

const en = language === 'en';
const text = (ru: string, english: string) => en ? english : ru;
const name = (id: string) => { const c = FLAG_COUNTRIES.find(c => c.id === id)!; return en ? c.en : c.ru; };
const money = (v: string) => (Number(v) / 100).toLocaleString(en ? 'en-US' : 'ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const flags = (n: number) => en ? `${n} flags` : `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'флаг' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'флага' : 'флагов'}`;
export class FlagBattleUI {
  private root = document.createElement('section');
  private arena: FlagArena;
  private audio = new FlagAudio();
  private lifetime = new AbortController();
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private owner = client.accountId;
  private mode: FlagMode = 'classic';
  private selected: FlagCountry = 'RU';
  private stake = '100';
  private seen = '';
  private view?: FlagView;
  private returned = '0';
  private spent = '100';
  private running = false;
  private submitting = false;
  private fresh = false;
  private frame = 0;
  private eliminated = 0;
  private error = '';
  constructor(host: HTMLElement) {
    this.root.className = 'fb-root';
    this.root.innerHTML = `<header class="fb-header"><div><span class="fb-kicker">ROYAL ORIGINALS / 001</span><h2>${text('Флажочки', 'Flag Battle')}<span>FLAG BATTLE ROYALE</span></h2></div><button type="button" data-fb="rules" class="fb-help" aria-label="${text('Правила игры', 'Game rules')}">?</button></header>
<div class="fb-layout"><div class="fb-stage"><div class="fb-stage-top"><span class="fb-badge">${text('ОДНА АРЕНА. ОДИН ПОБЕДИТЕЛЬ.', 'ONE ARENA. ONE WINNER.')}</span><span class="fb-counter"><b data-fb="count">12</b> / <span data-fb="total">12</span></span></div><canvas aria-label="${text('Арена флагов', 'Flag arena')}"></canvas><div class="fb-moment"><span data-fb="caption"></span><strong data-fb="headline"></strong><span data-fb="detail"></span></div><div class="fb-ticker" data-fb="ticker" aria-label="${text('Выбывшие страны', 'Eliminated countries')}"></div></div>
<aside class="fb-controls"><div class="fb-mode-heading">${text('Масштаб битвы', 'Battle size')}</div><div class="fb-modes" role="group" aria-label="${text('Режим игры', 'Game mode')}">${FLAG_MODES.map(m => `<button type="button" data-mode="${m.id}" aria-pressed="${m.id === this.mode}"><b>${m.count}</b><span>${en ? m.en : m.ru}</span></button>`).join('')}</div><p class="fb-mode-odds" data-fb="odds"></p>
<div class="fb-pick-heading"><span>01</span><h3>${text('Выбери свой флаг', 'Pick your flag')}</h3><small data-fb="pick-odds"></small></div><input type="search" class="fb-search" data-fb="search" placeholder="${text('Найти страну', 'Find a country')}" aria-label="${text('Найти страну', 'Find a country')}" hidden><div class="fb-countries"></div><p class="fb-empty" data-fb="empty" hidden>${text('Страна не найдена.', 'No matching country.')}</p>
<div class="fb-bet"><label for="fb-stake">02 &nbsp; ${text('Твоя ставка', 'Your stake')}</label><select id="fb-stake">${FLAG_BETS.map(s => `<option value="${s}">${money(s)} USDT</option>`).join('')}</select></div><div class="fb-quote"><span>${text('Выплата за победу', 'Return on a win')}</span><b data-fb="quote"></b><small data-fb="multiplier"></small></div><button type="button" data-fb="play" class="fb-play"></button><button type="button" data-fb="skip" class="fb-skip" hidden>${text('Показать результат', 'Show result')}</button><button type="button" data-fb="retry" class="fb-retry" hidden>${text('Проверить ту же ставку', 'Check the same bet')}</button><p class="fb-status" data-fb="status" role="status" aria-live="polite"></p><p class="fb-fair">${text('Равные шансы для каждой страны', 'Equal odds for every country')}<span>RTP 96% · USDT ${text('Демо', 'Demo')}</span></p></aside></div>
<dialog class="fb-rules"><h3>${text('Как играть', 'How to play')}</h3><p>${text('Выбери режим, страну и ставку. В битве участвуют 12, 24 или 48 разных стран. Флаги покидают арену один за другим. Если твоя страна остаётся последней, ты получаешь выплату, иначе выплата равна нулю.', 'Choose a mode, country and stake. The battle has 12, 24 or 48 different countries. Flags leave the arena one by one. If your country is last, you receive the return. Otherwise the return is zero.')}</p><table><thead><tr><th>${text('Страны', 'Countries')}</th><th>${text('Шанс', 'Chance')}</th><th>${text('Выплата', 'Return')}</th></tr></thead><tbody>${FLAG_MODES.map(m => `<tr><td>${m.count}</td><td>1 / ${m.count}</td><td>${(m.multiplier / 100).toLocaleString(en ? 'en-US' : 'ru-RU')}×</td></tr>`).join('')}</tbody></table><p>${text('Выплата включает ставку. RTP каждого режима: 96%. Ставки от 1 до 50 USDT на общем демобалансе. Ускорение показа не меняет исход. Принятый результат сохраняется при закрытии и потере связи. Дополнительных списаний нет.', 'The return includes the stake. Every mode has 96% RTP. Stakes from 1 to 50 USDT use the shared demo wallet. Skipping the animation does not change the outcome. Accepted results survive closing and lost connections. There are no additional charges.')}</p><button type="button" data-fb="close-rules">${text('Понятно', 'Got it')}</button></dialog>`;
    host.replaceChildren(this.root);
    this.arena = new FlagArena(this.find('canvas'));
    const signal = this.lifetime.signal;
    this.root.addEventListener('pointerdown', () => { void this.audio.unlock(); }, { signal });
    this.root.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.dataset.mode && !this.blocked()) this.chooseMode(button.dataset.mode as FlagMode);
      if (button.dataset.country && !this.blocked()) { this.selected = button.dataset.country as FlagCountry; this.selectionSound(); this.render(); }
      if (button.dataset.fb === 'play') void this.send(false);
      if (button.dataset.fb === 'retry') void this.send(true);
      if (button.dataset.fb === 'skip') this.finish(false);
      if (button.dataset.fb === 'rules') this.find<HTMLDialogElement>('dialog').showModal();
      if (button.dataset.fb === 'close-rules') this.find<HTMLDialogElement>('dialog').close();
    }, { signal });
    this.find<HTMLInputElement>('[data-fb="search"]').addEventListener('input', () => this.filterCountries(), { signal });
    this.find<HTMLSelectElement>('select').addEventListener('change', e => { this.stake = (e.target as HTMLSelectElement).value; this.selectionSound(); this.render(); }, { signal });
    client.addEventListener('change', () => this.sync(), { signal });
    demoWallet.addEventListener('change', () => this.render(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.audio.silence(); this.finish(false); } }, { signal });
    this.motion.addEventListener('change', () => { if (this.motion.matches) this.finish(false); }, { signal });
    this.sync(); this.frame = requestAnimationFrame(t => this.tick(t)); void client.refresh();
  }
  private get count() { return flagModeInfo(this.mode).count; }
  private chooseMode(mode: FlagMode) {
    if (mode === this.mode) return;
    this.mode = mode; this.view = undefined; this.returned = '0'; this.eliminated = 0;
    if (!flagCountries(mode).some(c => c.id === this.selected)) this.selected = 'RU';
    this.find<HTMLInputElement>('[data-fb="search"]').value = '';
    this.audio.silence(); this.arena.reset(undefined, mode); this.find('[data-fb="ticker"]').replaceChildren();
    this.selectionSound(); this.render();
  }
  private selectionSound() {
    const account = this.owner;
    void this.audio.unlock().then(() => { if (this.owner === account && !this.lifetime.signal.aborted && !this.blocked() && !document.hidden) this.audio.cue('select'); });
  }
  private find<T extends Element = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private put(id: string, value: string) { this.find(`[data-fb="${id}"]`).textContent = value; }
  private blocked() { return this.running || this.submitting || client.busy || client.loading || !!client.pending || demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy('expansion'); }
  private sync() {
    if (this.owner !== client.accountId) {
      this.audio.silence(); this.owner = client.accountId; this.running = false; this.fresh = false; this.seen = ''; this.view = undefined;
      this.submitting = false; this.error = ''; this.mode = 'classic'; this.selected = 'RU'; this.stake = '100'; this.arena.reset();
      this.find<HTMLInputElement>('[data-fb="search"]').value = '';
    }
    const pending = client.pending;
    if (pending?.gameId === FLAG_GAME && pending.action === 'start' && validFlagSettings(pending.settings)) {
      const mode = pending.settings.flags.mode ?? 'classic';
      if (this.mode !== mode) { this.mode = mode; this.view = undefined; this.eliminated = 0; this.arena.reset(undefined, mode); }
      this.selected = pending.settings.flags.country; this.stake = pending.stakeUnits;
    }
    const session = client.sessions.find(s => s.gameId === FLAG_GAME);
    if (session && session.id !== this.seen && !client.pending) {
      this.seen = session.id; this.view = session.view.flags; this.returned = session.returnedUnits; this.spent = session.stakeUnits;
      this.mode = flagViewMode(this.view!); this.arena.reset(this.view); this.eliminated = 0; this.find('[data-fb="ticker"]').replaceChildren();
      this.find<HTMLInputElement>('[data-fb="search"]').value = '';
      const fresh = this.fresh;
      this.running = fresh && !this.motion.matches && !document.hidden;
      this.selected = this.view!.country; this.stake = session.stakeUnits; this.fresh = false;
      if (this.running) this.audio.begin(this.seen, this.arena.soundTimeline(this.view!.country, this.returned !== '0'));
      else { this.arena.finish(); this.eliminated = this.count - 1; this.audio.silence(); if (fresh && !document.hidden) this.audio.instantResult(this.seen, this.returned !== '0'); }
    }
    this.render();
  }
  private filterCountries() {
    const query = this.find<HTMLInputElement>('[data-fb="search"]').value.trim().toLocaleLowerCase();
    let visible = 0;
    this.root.querySelectorAll<HTMLButtonElement>('[data-country]').forEach(b => { b.hidden = !name(b.dataset.country!).toLocaleLowerCase().includes(query) && !b.dataset.country!.toLowerCase().includes(query); if (!b.hidden) visible++; });
    this.find('[data-fb="empty"]').hidden = visible > 0;
  }
  private render() {
    const blocked = this.blocked(), pending = client.pending?.gameId === FLAG_GAME;
    this.root.dataset.presenting = String(this.running); this.root.dataset.mode = this.mode;
    const grid = this.find('.fb-countries');
    if (grid.getAttribute('data-mode') !== this.mode) {
      grid.setAttribute('data-mode', this.mode);
      grid.innerHTML = flagCountries(this.mode).map(c => `<button type="button" data-country="${c.id}" aria-pressed="false"><img src="${flagAsset(c.id)}" alt=""><span>${name(c.id)}</span></button>`).join('');
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-country]').forEach(b => { b.disabled = blocked; b.setAttribute('aria-pressed', String(b.dataset.country === this.selected)); });
    this.root.querySelectorAll<HTMLButtonElement>('button[data-mode]').forEach(b => { b.disabled = blocked; b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode)); });
    this.find<HTMLInputElement>('[data-fb="search"]').hidden = this.count === 12;
    this.find<HTMLInputElement>('[data-fb="search"]').disabled = blocked; this.filterCountries();
    this.find<HTMLSelectElement>('select').disabled = blocked; this.find<HTMLSelectElement>('select').value = this.stake;
    this.put('total', String(this.count)); this.put('count', String(this.count - this.eliminated));
    this.find('[data-fb="ticker"]').innerHTML = (this.view?.order.slice(0, this.eliminated) ?? []).map(id => `<span title="${name(id)}"><img src="${flagAsset(id)}" alt="${name(id)}"><i>×</i></span>`).join('');
    this.put('pick-odds', `1 / ${this.count}`);
    this.put('odds', text(`Шанс победы: 1 из ${this.count}`, `Chance to win: 1 in ${this.count}`));
    const play = this.find<HTMLButtonElement>('[data-fb="play"]');
    play.disabled = blocked || !client.accountId || !client.wallet;
    play.textContent = this.submitting || client.busy ? text('Принимаем ставку…', 'Confirming bet…') : this.running ? text('Битва идёт…', 'Battle in progress…') : text('Начать битву', 'Start battle') + ' ↗';
    this.find('[data-fb="skip"]').hidden = !this.running;
    this.find<HTMLButtonElement>('[data-fb="retry"]').hidden = !pending; this.find<HTMLButtonElement>('[data-fb="retry"]').disabled = client.busy || this.submitting;
    this.put('quote', money(flagPayout(this.stake, this.mode)) + ' USDT');
    this.put('multiplier', (flagModeInfo(this.mode).multiplier / 100).toLocaleString(en ? 'en-US' : 'ru-RU') + '×');
    this.put('status', this.error || client.error || (!client.accountId ? text('Войди в аккаунт для ставки.', 'Sign in to place a bet.') : pending ? text('Проверь отправленную ставку. Новый запрос не нужен.', 'Check your submitted bet before starting another.') : this.running ? text('Болей за свой флаг.', 'Cheer for your flag.') : text('Выбери страну. Шансы у всех равны.', 'Pick a country. Every flag has equal odds.')));
    this.moment();
  }
  private moment() {
    const done = !!this.view && !this.running, remaining = this.count - this.eliminated;
    this.put('caption', done ? text('БИТВА ЗАВЕРШЕНА', 'BATTLE COMPLETE') : this.running ? remaining === 1 ? text('ПОСЛЕДНИЙ ФЛАГ', 'LAST FLAG STANDING') : remaining === 2 ? text('ФИНАЛЬНАЯ ДВОЙКА', 'FINAL TWO') : text('В ИГРЕ', 'IN THE ARENA') : text('ЗА КОГО ТЫ?', 'WHO IS YOUR PICK?'));
    this.put('headline', done ? name(this.view!.order.at(-1)!) : this.running ? flags(remaining) : text('Весь мир на арене', 'The world in one arena'));
    this.put('detail', done ? this.returned !== '0' ? text('Твоя страна победила! Выплата ', 'Your country won! Return ') + money(this.returned) + ' USDT' : text('Выплата 0,00 USDT · Ставка ', 'Return 0.00 USDT · Stake ') + money(this.spent) : this.running ? name(this.selected) + ' · ' + text('твой выбор', 'your pick') : text(`${this.count} стран. Последний забирает победу.`, `${this.count} countries. Last flag standing wins.`));
    this.root.dataset.won = String(done && this.returned !== '0');
  }
  private finish(sound: boolean) {
    if (!sound) this.audio.silence();
    if (!this.running) return;
    this.running = false; this.arena.finish(); this.eliminated = this.count - 1; this.render();
    if (sound) this.audio.complete();
  }
  private tick(now: number) {
    const state = this.arena.tick(now, this.running, this.view?.country ?? this.selected, !this.motion.matches);
    if (this.running) this.audio.advance(state.playhead, now);
    if (state.eliminated !== this.eliminated) {
      this.eliminated = state.eliminated; this.put('count', String(this.count - this.eliminated));
      this.find('[data-fb="ticker"]').innerHTML = (this.view?.order.slice(0, this.eliminated) ?? []).map(id => `<span title="${name(id)}"><img src="${flagAsset(id)}" alt="${name(id)}"><i>×</i></span>`).join('');
      this.moment();
    }
    if (state.finished) this.finish(true);
    this.frame = requestAnimationFrame(t => this.tick(t));
  }
  private async send(retry: boolean) {
    if (this.submitting || this.running || client.busy || !client.accountId || document.hidden || !retry && this.blocked()) return;
    const account = this.owner;
    this.error = ''; this.submitting = true; this.fresh = true; void this.audio.unlock(); this.render();
    try {
      if (retry) await client.retry();
      else await client.act({ gameId: FLAG_GAME, action: 'start', stakeUnits: this.stake, settings: { flags: { country: this.selected, mode: this.mode } } });
    } catch (e) { if (this.owner === account) { this.error = (e as Error).message; this.fresh = false; } }
    finally { if (!this.lifetime.signal.aborted && this.owner === account) { this.submitting = false; this.sync(); } }
  }
  pause() { this.audio.silence(); this.finish(false); }
  resume() {}
  getState() { return { gameId: FLAG_GAME, sessionId: this.seen, presenting: this.running, mode: this.mode, count: this.count, country: this.selected, eliminated: this.eliminated, returnedUnits: this.returned, physics: this.arena.getState(), audio: this.audio.state() }; }
  destroy() { this.audio.destroy(); this.lifetime.abort(); cancelAnimationFrame(this.frame); this.find<HTMLDialogElement>('dialog').close(); this.root.remove(); }
}
