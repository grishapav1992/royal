import {stakeRulesHtml} from './stakeRules';
import {GAME_BETS as DEMO_BETS} from '../shared/gameStakes';
import { t as translateText, tr, locale } from '../i18n/index';
import { } from '../shared/demoWallet';
import type { ExpansionSession } from '../shared/casinoExpansion';
import { expansionClient as client, type NewExpansionAction } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { observeExpansionOutcome, resetGameOutcomes } from './gameReactions';
import './casino-expansion.css';
import './crash-motion.css';

const amount = (units: string) => (Number(units) / 100).toLocaleString(locale, {maximumFractionDigits: 2}) + translateText(' USDT');
export class CrashMotionUI {
  private root = document.createElement('section');
  private alive = true;
  private owner = client.accountId;
  private epoch = 0;
  private stake = '10';
  private error = '';
  private frame = 0;
  private poll: ReturnType<typeof setInterval>;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private heldBalance?: number;
  private endTimer?: ReturnType<typeof setTimeout>;
  private shownTime = 0;
  private anchor?: {id: string; from: number; to: number; at: number};
  private reactionFollow = false;
  private change = () => this.sync();
  private clearEndCue() { clearTimeout(this.endTimer); this.endTimer = undefined; this.root.classList.remove('crash-ended-cue'); }
  private visibility = () => { this.clearEndCue(); cancelAnimationFrame(this.frame); this.frame = 0; if (document.hidden) { this.reactionFollow = false; resetGameOutcomes(this.root); } this.sync(); if (!document.hidden) void client.refresh(); };
  private motionChange = () => { this.clearEndCue(); cancelAnimationFrame(this.frame); this.frame = 0; this.sync(); };
  constructor(private host: HTMLElement) {
    resetGameOutcomes(this.root);
    this.root.className = 'casino-expansion crash-motion'; this.root.dataset.game = 'github-crash';
    this.root.setAttribute('aria-label', 'Crash');
    this.root.innerHTML = tr`<div class="expansion-toolbar"><strong data-expansion-balance></strong><label>Ставка<select data-stake>${DEMO_BETS.map(value => tr`<option value="${value * 100}">${value} USDT</option>`).join('')}</select></label></div><div class="expansion-board"><div class="expansion-flight"><div class="crash-sky" aria-hidden="true"><i></i><i></i><i></i></div><span class="crash-ship" aria-hidden="true">✦</span><strong data-crash-value>1.00×</strong><small data-crash-caption>Готов к полёту</small><div class="crash-trail" aria-hidden="true"></div></div></div><p class="expansion-message" role="status"></p><p data-crash-status></p><div class="expansion-actions"><button data-start>Начать игру</button><button data-move="cashout" hidden>Забрать выплату</button><button data-retry hidden>Проверить ход</button><button data-refresh>Обновить</button></div><p class="expansion-error" role="alert"></p><details><summary>Правила и выплаты</summary><p>Множитель растёт во время полёта. Забери выплату до остановки. Результат и выплату подтверждает сервер.</p><p>Движение следует только последнему подтверждённому времени сервера. При задержке связи множитель остаётся на подтверждённом значении. Незавершённая партия сохраняется при закрытии.</p><p>Общий баланс USDT клуба. Множители включают ставку, доли цента учитываются при завершении раунда.</p>${stakeRulesHtml()}</details>`;
    host.replaceChildren(this.root);
    this.find<HTMLSelectElement>('[data-stake]').onchange = event => { if (!client.busy && !client.pending) this.stake = (event.target as HTMLSelectElement).value; };
    this.find('[data-start]').onclick = () => void this.act({gameId: 'github-crash', action: 'start', stakeUnits: this.stake, settings: {}});
    this.find('[data-move]').onclick = () => { const session = this.session(); if (session?.state === 'active') void this.act({gameId: 'github-crash', action: 'move', sessionId: session.id, move: 'cashout'}); };
    this.find('[data-retry]').onclick = () => void this.retry();
    this.find('[data-refresh]').onclick = () => { this.reactionFollow = false; resetGameOutcomes(this.root); void client.refresh(); };
    client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change);
    document.addEventListener('visibilitychange', this.visibility); this.reduced.addEventListener('change', this.motionChange);
    this.poll = setInterval(() => { if (this.alive && !document.hidden && !client.busy && !client.pending && !client.loading && this.session()?.state === 'active') void client.refresh(); }, 400);
    this.sync(); void client.refresh();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string) { return this.root.querySelector<T>(selector)!; }
  private session() { return client.sessions.find(session => session.gameId === 'github-crash'); }
  private validTime(session: ExpansionSession) { return Number.isFinite(session.serverNow) && Number.isFinite(session.startedAt) && Number.isFinite(session.multiplier) && session.multiplier! >= 1 && session.multiplier! <= 100; }
  private sync() {
    if (!this.alive) return;
    if (this.owner !== client.accountId) { this.clearEndCue(); this.epoch++; this.owner = client.accountId; this.stake = '10'; this.error = ''; this.anchor = undefined; this.heldBalance = undefined; this.shownTime = 0; this.reactionFollow = false; resetGameOutcomes(this.root); cancelAnimationFrame(this.frame); this.frame = 0; }
    const session = this.session();
    const justEnded = session?.state === 'settled' && this.anchor?.id === session.id;
    if (session?.state === 'active' && this.validTime(session)) {
      if (!this.anchor || this.anchor.id !== session.id) this.anchor = {id: session.id, from: session.serverNow!, to: session.serverNow!, at: performance.now()};
      else if (session.serverNow! > this.anchor.to) this.anchor = {id: session.id, from: Math.min(this.shownTime || this.anchor.to, session.serverNow!), to: session.serverNow!, at: performance.now()};
    } else this.anchor = undefined;
    this.controls(session);
    if (session?.state === 'active') this.clearEndCue();
    else if (justEnded && !document.hidden && !this.reduced.matches) {
      this.clearEndCue(); this.root.classList.add('crash-ended-cue');
      const epoch = this.epoch, account = client.accountId, id = session.id;
      let endTimer: ReturnType<typeof setTimeout>;
      endTimer = setTimeout(() => {
        if (!this.alive || this.endTimer !== endTimer) return;
        this.clearEndCue();
        if (epoch === this.epoch && account === client.accountId && account === this.owner && id === this.session()?.id && !document.hidden) this.observeReaction(this.session());
      }, 320);
      this.endTimer = endTimer;
    }
    if (this.reduced.matches || document.hidden || session?.state !== 'active') { cancelAnimationFrame(this.frame); this.frame = 0; this.paint(session, performance.now(), true); }
    else if (!this.frame) this.frame = requestAnimationFrame(now => this.tick(now));
    this.observeReaction(session);
  }
  private observeReaction(session?: ExpansionSession) {
    observeExpansionOutcome(this.root, 'github-crash', session, client.accountId,
      client.busy || client.loading || this.heldBalance !== undefined || !!this.endTimer || !this.reactionFollow || document.hidden,
      this.reactionFollow && client.pending?.gameId === 'github-crash');
  }
  private controls(session?: ExpansionSession) {
    const active = session?.state === 'active', balance = demoWallet.wallet?.balance ?? client.wallet?.balance;
    const ready = !!client.accountId && balance !== undefined;
    const blocked = client.busy || !!client.pending || client.loading || document.hidden;
    this.root.dataset.sessionId = session?.id ?? ''; this.root.dataset.state = session?.state ?? 'idle'; this.root.dataset.reducedMotion = String(this.reduced.matches);
    this.find('[data-expansion-balance]').textContent = balance === undefined ? translateText('Баланс загружается') : tr`${(this.heldBalance ?? balance).toLocaleString(locale)} USDT`;
    const stake = this.find<HTMLSelectElement>('[data-stake]'); if (active) this.stake = session.stakeUnits; stake.value = this.stake; stake.disabled = !!active || blocked;
    const start = this.find<HTMLButtonElement>('[data-start]'); start.hidden = !!active; start.disabled = blocked || !ready || Number(this.stake) > (balance ?? 0) * 100; start.textContent = `${session ? translateText('Новая партия') : translateText('Начать игру')} · ${amount(this.stake)}`;
    const cashout = this.find<HTMLButtonElement>('[data-move]'); cashout.hidden = !active; cashout.disabled = blocked || !ready || !session || !this.validTime(session) || session.serverNow! < session.startedAt!;
    const retry = this.find<HTMLButtonElement>('[data-retry]'); retry.hidden = !client.pending || client.pending.gameId !== 'github-crash'; retry.disabled = client.busy || client.loading;
    this.find<HTMLButtonElement>('[data-refresh]').disabled = client.busy || client.loading || document.hidden;
    this.find('.expansion-message').textContent = client.pending ? translateText('Подтверждаем ту же операцию…') : translateText(session?.view.message ?? '');
    this.find('[data-crash-status]').textContent = !ready ? translateText('Войди в аккаунт и дождись баланса.') : session ? tr`${active ? translateText('Партия сохранена') : translateText('Раунд завершён')} · Ставки: ${amount(session.spentUnits)} · Возвращено: ${amount(session.returnedUnits)}` : translateText('Выбери ставку и начни полёт.');
    this.find('.expansion-error').textContent = this.error || client.error; this.root.setAttribute('aria-busy', String(client.busy || !!client.pending));
  }
  private tick(now: number) { this.frame = 0; if (!this.alive || document.hidden) return; this.paint(this.session(), now, false); if (!this.reduced.matches && this.session()?.state === 'active') this.frame = requestAnimationFrame(time => this.tick(time)); }
  private paint(session: ExpansionSession | undefined, now: number, quiet: boolean) {
    if (!this.alive) return;
    const flight = this.find('.expansion-flight'), ship = this.find('.crash-ship');
    const active = session?.state === 'active' && this.validTime(session), lost = session?.state === 'settled' && session.returnedUnits === '0';
    flight.classList.toggle('crashed', !!lost);
    let value = 1, waiting = false, time = 0;
    if (active && this.anchor?.id === session.id) {
      const progress = quiet ? 1 : Math.max(0, Math.min(1, (now - this.anchor.at) / 320));
      time = Math.min(this.anchor.to, this.anchor.from + (this.anchor.to - this.anchor.from) * progress); this.shownTime = time;
      waiting = time < session.startedAt!;
      // Only confirmed server time is interpolated. No future crash value is read.
      value = Math.min(session.multiplier!, 100, Math.exp(.06 * Math.max(0, (time - session.startedAt!) / 1000)));
      this.root.dataset.confirmedServerNow = String(session.serverNow); this.root.dataset.displayServerNow = String(time);
    } else { delete this.root.dataset.confirmedServerNow; delete this.root.dataset.displayServerNow; if (session?.state === 'settled') value = lost ? session.crashAt ?? session.multiplier ?? 1 : session.multiplier ?? 1; }
    const phase = active ? waiting ? 'waiting' : 'flying' : session?.state === 'settled' ? lost ? 'crashed' : 'cashed-out' : 'idle';
    this.root.dataset.motionPhase = phase; this.find('[data-crash-value]').textContent = waiting ? tr`Старт через ${Math.max(1, Math.ceil((session!.startedAt! - time) / 1000))}` : `${value.toFixed(2)}×`;
    this.find('[data-crash-caption]').textContent = active ? waiting ? translateText('Ждём подтверждённого начала') : translateText('Текущий подтверждённый полёт') : session?.state === 'settled' ? lost ? translateText('Полёт остановился') : translateText('Выплата подтверждена') : client.busy ? translateText('Ждём подтверждения ставки') : translateText('Готов к полёту');
    const progress = Math.max(0, Math.min(1, Math.log(Math.max(1, value)) / Math.log(100)));
    const bob = active && !quiet && !this.reduced.matches ? Math.sin(now / 190) * 3 : 0;
    const positioned = active && !waiting || session?.state === 'settled';
    const distance = Math.min(280, Math.max(0, flight.clientWidth / 2 - 40));
    ship.style.transform = `translate(${positioned ? progress * distance : 0}px,${positioned ? -progress * 60 + bob : bob}px) rotate(${positioned ? -8 : 0}deg)`;
    this.find('.crash-trail').style.width = `${Math.max(0, progress * 50)}%`;
  }
  private async act(op: NewExpansionAction) {
    if (!this.alive || document.hidden || client.busy || client.pending) return;
    const account = client.accountId, epoch = this.epoch; this.error = ''; this.heldBalance = demoWallet.wallet?.balance ?? client.wallet?.balance; this.clearEndCue(); this.reactionFollow = true;
    try { await client.act(op); } catch (error) { if (this.alive && account === client.accountId && epoch === this.epoch) { this.error = (error as Error).message; this.reactionFollow = false; resetGameOutcomes(this.root); } }
    if (this.alive && account === client.accountId && epoch === this.epoch) { this.heldBalance = undefined; this.sync(); }
  }
  private async retry() { this.reactionFollow = false; resetGameOutcomes(this.root); const account = client.accountId, epoch = this.epoch; try { await client.retry(); } catch (error) { if (this.alive && account === client.accountId && epoch === this.epoch) this.error = (error as Error).message; } this.sync(); }
  destroy() { this.alive = false; this.epoch++; this.reactionFollow = false; resetGameOutcomes(this.root); this.clearEndCue(); cancelAnimationFrame(this.frame); clearInterval(this.poll); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.reduced.removeEventListener('change', this.motionChange); this.root.remove(); }
}
