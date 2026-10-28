import { FLAG_GAME, FLAG_BETS, FLAG_COUNTRIES, flagPayout, type FlagCountry, type FlagView } from '../../src/shared/flagBattle';
import { expansionClient as client } from '../../src/wallet/ExpansionClient';
import { demoWallet } from '../../src/wallet/WalletClient';
import { FlagAudio } from './FlagAudio';
import { language } from '../../src/i18n/index';
import { FlagArena, flagAsset } from './FlagArena';

const en = language === 'en';
const text = (ru: string, english: string) => en ? english : ru;
const name = (id: string) => { const c = FLAG_COUNTRIES.find(c => c.id === id)!; return en ? c.en : c.ru; };
const money = (v: string) => (Number(v) / 100).toLocaleString(en ? 'en-US' : 'ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export class FlagBattleUI {
  private root = document.createElement('section');
  private arena: FlagArena;
  private audio = new FlagAudio();
  private lifetime = new AbortController();
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private owner = client.accountId;
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
<div class="fb-layout"><div class="fb-stage"><div class="fb-stage-top"><span class="fb-badge">${text('ОДНА АРЕНА. ОДИН ПОБЕДИТЕЛЬ.', 'ONE ARENA. ONE WINNER.')}</span><span class="fb-counter"><b data-fb="count">12</b> / 12</span></div><canvas aria-label="${text('Арена флагов', 'Flag arena')}"></canvas><div class="fb-moment"><span data-fb="caption"></span><strong data-fb="headline"></strong><span data-fb="detail"></span></div><div class="fb-ticker" data-fb="ticker" aria-label="${text('Выбывшие страны', 'Eliminated countries')}"></div></div>
<aside class="fb-controls"><div class="fb-pick-heading"><span>01</span><h3>${text('Выбери свой флаг', 'Pick your flag')}</h3><small>1 / 12</small></div><div class="fb-countries">${FLAG_COUNTRIES.map(c => `<button type="button" data-country="${c.id}" aria-pressed="${c.id === this.selected}"><img src="${flagAsset(c.id)}" alt=""><span>${name(c.id)}</span></button>`).join('')}</div><div class="fb-bet"><label for="fb-stake">02 &nbsp; ${text('Твоя ставка', 'Your stake')}</label><select id="fb-stake">${FLAG_BETS.map(s => `<option value="${s}">${money(s)} USDT</option>`).join('')}</select></div><div class="fb-quote"><span>${text('Выплата за победу', 'Return on a win')}</span><b data-fb="quote"></b><small>11.52×</small></div><button type="button" data-fb="play" class="fb-play"></button><button type="button" data-fb="skip" class="fb-skip" hidden>${text('Показать результат', 'Show result')}</button><button type="button" data-fb="retry" class="fb-retry" hidden>${text('Проверить ту же ставку', 'Check the same bet')}</button><p class="fb-status" data-fb="status" role="status" aria-live="polite"></p><p class="fb-fair">${text('Равные шансы для каждой страны', 'Equal odds for every country')}<span>RTP 96% · USDT ${text('Демо', 'Demo')}</span></p></aside></div>
<dialog class="fb-rules"><h3>${text('Как играть', 'How to play')}</h3><p>${text('Выбери одну из 12 стран и ставку. Флаги покидают арену один за другим. Если твоя страна остаётся последней, выплата составит 11,52× ставки, включая саму ставку. Иначе выплата равна нулю.', 'Choose one of 12 countries and a stake. Flags leave the arena one by one. If your country is last, the total return is 11.52 times your stake, including the stake. Otherwise the return is zero.')}</p><p>${text('Шанс каждой страны: 1 из 12. RTP: 96%. Ставки от 1 до 50 USDT на общем демобалансе. Ускорение показа не меняет исход. Принятый результат сохраняется при закрытии и потере связи. Дополнительных списаний нет.', 'Every country has a 1 in 12 chance. RTP: 96%. Stakes from 1 to 50 USDT use the shared demo wallet. Skipping the animation does not change the outcome. Accepted results survive closing and lost connections. There are no additional charges.')}</p><button type="button" data-fb="close-rules">${text('Понятно', 'Got it')}</button></dialog>`;
    host.replaceChildren(this.root);
    this.arena = new FlagArena(this.find('canvas'));
    const signal = this.lifetime.signal;
    this.root.addEventListener('pointerdown', () => { void this.audio.unlock(); }, { signal });
    this.root.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.dataset.country && !this.blocked()) { this.selected = button.dataset.country as FlagCountry; this.selectionSound(); this.render(); }
      if (button.dataset.fb === 'play') void this.send(false);
      if (button.dataset.fb === 'retry') void this.send(true);
      if (button.dataset.fb === 'skip') this.finish(false);
      if (button.dataset.fb === 'rules') this.find<HTMLDialogElement>('dialog').showModal();
      if (button.dataset.fb === 'close-rules') this.find<HTMLDialogElement>('dialog').close();
    }, { signal });
    this.find<HTMLSelectElement>('select').addEventListener('change', e => { this.stake = (e.target as HTMLSelectElement).value; this.selectionSound(); this.render(); }, { signal });
    client.addEventListener('change', () => this.sync(), { signal });
    demoWallet.addEventListener('change', () => this.render(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.audio.silence(); this.finish(false); } }, { signal });
    this.motion.addEventListener('change', () => { if (this.motion.matches) this.finish(false); }, { signal });
    this.sync(); this.frame = requestAnimationFrame(t => this.tick(t));
    void client.refresh();
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
      this.submitting = false; this.error = ''; this.selected = 'RU'; this.stake = '100'; this.arena.reset();
    }
    const session = client.sessions.find(s => s.gameId === FLAG_GAME);
    if (session && session.id !== this.seen && !client.pending) {
      this.seen = session.id; this.view = session.view.flags; this.returned = session.returnedUnits; this.spent = session.stakeUnits;
      this.arena.reset(this.view); this.eliminated = 0; this.put('count', '12'); this.find('[data-fb="ticker"]').replaceChildren();
      const fresh = this.fresh;
      this.running = fresh && !this.motion.matches && !document.hidden;
      this.selected = this.view!.country; this.stake = session.stakeUnits;
      this.fresh = false;
      if (this.running) this.audio.begin(this.seen, this.arena.soundTimeline(this.view!.country, this.returned !== '0'));
      else { this.arena.finish(); this.audio.silence(); if (fresh && !document.hidden) this.audio.instantResult(this.seen, this.returned !== '0'); }
    }
    this.render();
  }
  private render() {
    const blocked = this.blocked(), pending = client.pending?.gameId === FLAG_GAME;
    this.root.dataset.presenting = String(this.running);
    this.root.querySelectorAll<HTMLButtonElement>('[data-country]').forEach(b => { b.disabled = blocked; b.setAttribute('aria-pressed', String(b.dataset.country === this.selected)); });
    this.find<HTMLSelectElement>('select').disabled = blocked;
    this.find<HTMLSelectElement>('select').value = this.stake;
    const play = this.find<HTMLButtonElement>('[data-fb="play"]');
    play.disabled = blocked || !client.accountId || !client.wallet;
    play.textContent = this.submitting || client.busy ? text('Принимаем ставку…', 'Confirming bet…') : this.running ? text('Битва идёт…', 'Battle in progress…') : text('Начать битву', 'Start battle') + ' ↗';
    this.find('[data-fb="skip"]').hidden = !this.running;
    this.find<HTMLButtonElement>('[data-fb="retry"]').hidden = !pending;
    this.find<HTMLButtonElement>('[data-fb="retry"]').disabled = client.busy || this.submitting;
    this.put('quote', money(flagPayout(this.stake)) + ' USDT');
    this.put('status', this.error || client.error || (!client.accountId ? text('Войди в аккаунт для ставки.', 'Sign in to place a bet.') : pending ? text('Проверь отправленную ставку. Новый запрос не нужен.', 'Check your submitted bet before starting another.') : this.running ? text('Болей за свой флаг.', 'Cheer for your flag.') : text('Выбери страну. Шансы у всех равны.', 'Pick a country. Every flag has equal odds.')));
    this.moment();
  }
  private moment() {
    const done = !!this.view && !this.running;
    this.put('caption', done ? text('БИТВА ЗАВЕРШЕНА', 'BATTLE COMPLETE') : this.running ? this.eliminated === 11 ? text('ПОСЛЕДНИЙ ФЛАГ', 'LAST FLAG STANDING') : this.eliminated >= 10 ? text('ФИНАЛЬНАЯ ДВОЙКА', 'FINAL TWO') : text('В ИГРЕ', 'IN THE ARENA') : text('ЗА КОГО ТЫ?', 'WHO IS YOUR PICK?'));
    this.put('headline', done ? name(this.view!.order[11]) : this.running ? String(12 - this.eliminated) + ' ' + text(this.eliminated === 11 ? 'флаг' : this.eliminated >= 8 ? 'флага' : 'флагов', this.eliminated === 11 ? 'flag' : 'flags') : text('Весь мир на арене', 'The world in one arena'));
    this.put('detail', done ? this.returned !== '0' ? text('Твоя страна победила! Выплата ', 'Your country won! Return ') + money(this.returned) + ' USDT' : text('Выплата 0,00 USDT · Ставка ', 'Return 0.00 USDT · Stake ') + money(this.spent) : this.running ? name(this.selected) + ' · ' + text('твой выбор', 'your pick') : text('12 стран. Последний забирает победу.', '12 countries. Last flag standing wins.'));
    this.root.dataset.won = String(done && this.returned !== '0');
  }
  private finish(sound: boolean) {
    if (!sound) this.audio.silence();
    if (!this.running) return;
    this.running = false; this.arena.finish(); this.render();
    if (sound) this.audio.complete();
  }
  private tick(now: number) {
    const state = this.arena.tick(now, this.running, this.view?.country ?? this.selected, !this.motion.matches);
    if (this.running) this.audio.advance(state.playhead, now);
    if (state.eliminated !== this.eliminated) {
      this.eliminated = state.eliminated;
      this.put('count', String(12 - this.eliminated));
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
      else await client.act({ gameId: FLAG_GAME, action: 'start', stakeUnits: this.stake, settings: { flags: { country: this.selected } } });
    } catch (e) { if (this.owner === account) { this.error = (e as Error).message; this.fresh = false; } }
    finally { if (!this.lifetime.signal.aborted && this.owner === account) { this.submitting = false; this.sync(); } }
  }
  pause() { this.audio.silence(); this.finish(false); }
  resume() {}
  getState() { return { gameId: FLAG_GAME, sessionId: this.seen, presenting: this.running, country: this.selected, eliminated: this.eliminated, returnedUnits: this.returned, physics: this.arena.getState(), audio: this.audio.state() }; }
  destroy() { this.audio.destroy(); this.lifetime.abort(); cancelAnimationFrame(this.frame); this.find<HTMLDialogElement>('dialog').close(); this.root.remove(); }
}
