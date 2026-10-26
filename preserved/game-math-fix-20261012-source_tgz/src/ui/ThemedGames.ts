import '../themed-games.css';
import { DEMO_BETS } from '../shared/demoWallet';
import type { GameRound } from '../shared/gameCore';
import { FLIGHT_MIN_AUTO_CASHOUT, FLIGHT_MAX_MULTIPLIER } from '../shared/flightGame';
import { WHEEL_MULTIPLIERS, WHEEL_RISKS, type WheelRisk } from '../shared/themedGames';
import { gameAudio } from '../game/GameAudio';
import { ThemedGameArt, wheelLandingRotation, type ThemedGameId } from '../game/themedGameArt';
import { demoWallet, coins, type WalletSettlement } from '../wallet/WalletClient';
import { flightClient } from '../wallet/FlightClient';

const mult = (value: number) => `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
const riskLabels: Record<WheelRisk, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
type WheelRound = Extract<GameRound, { gameId: 'royal-wheel' }>;

export class ThemedGames {
  private root = document.createElement('section');
  private art: ThemedGameArt;
  private alive = true;
  private working = false;
  private accountId = demoWallet.accountId;
  private epoch = 0;
  private rotation = 0;
  private lastRound?: WheelRound;
  private cancelAnimation?: () => void;
  private timer: ReturnType<typeof setInterval>;
  private lastFlightSound = '';
  private message = 'Выбери ставку и начинай.';
  private localError = '';
  private update = () => {
    if (!this.alive) return;
    if (this.accountId !== demoWallet.accountId) {
      this.epoch++; this.cancelAnimation?.(); this.working = false;
      this.accountId = demoWallet.accountId; this.lastRound = undefined; this.rotation = 0; this.lastFlightSound = '';
      this.message = 'Выбери ставку и начинай.'; this.localError = ''; this.root.dataset.result = 'idle';
      this.art.update({ phase: 'idle', multiplier: 1, rotation: 0, selectedSegment: null });
    }
    this.render();
  };
  private settlement = (event: Event) => {
    const { accountId, operation, result } = (event as CustomEvent<WalletSettlement>).detail;
    if (!this.alive || this.working || this.gameId !== 'royal-wheel' || accountId !== demoWallet.accountId
      || operation.kind !== 'play' || operation.gameId !== 'royal-wheel' || result.gameRound?.gameId !== 'royal-wheel') return;
    void this.showWheel(result.gameRound, false);
  };

  constructor(container: HTMLElement, private gameId: ThemedGameId) {
    const flight = gameId === 'royal-flight';
    this.root.className = 'themed-game'; this.root.dataset.game = gameId; this.root.dataset.result = 'idle';
    this.root.innerHTML = `<header class="themed-header"><div><span class="themed-eyebrow">ROYAL ORIGINALS</span><h3>${flight ? 'Royal Orbit' : 'Royal Fortune'}</h3><p>${flight ? 'За пределы земного притяжения' : 'Твой счастливый поворот'}</p></div><div class="themed-wallet"><span>Демобаланс</span><strong id="themed-balance">…</strong><button type="button" id="themed-wallet" aria-label="Пополнить демобаланс">+</button></div></header>
      <div class="themed-layout"><div class="themed-scene"><canvas id="themed-canvas" aria-label="${flight ? 'Космический полёт Royal Orbit' : 'Колесо Royal Fortune, 50 секторов'}" role="img"></canvas>
        <div class="themed-scene-top"><span id="themed-scene-status">${flight ? 'ГОТОВ К СТАРТУ' : '50 РАВНЫХ СЕКТОРОВ'}</span><span class="themed-scene-tag">${flight ? 'ORBIT / 01' : 'FORTUNE / 02'}</span></div>
        ${flight ? '<div class="themed-flight-hud"><span>МНОЖИТЕЛЬ ПОЛЁТА</span><strong id="themed-multiplier">1,00×</strong><div id="themed-flight-value">Выбери цель и отправляйся в полёт</div></div>' : '<div class="themed-wheel-caption"><span id="themed-wheel-value">ВОЗМОЖНОСТЬ НА КАЖДОМ ПОВОРОТЕ</span></div>'}
      </div><aside class="themed-controls"><label for="themed-bet">Ставка, монеты</label><select id="themed-bet" data-themed-input>${DEMO_BETS.map(value => `<option value="${value}" ${value === 100 ? 'selected' : ''}>${value}</option>`).join('')}</select>
        ${flight ? `<label for="themed-target">Автоматически забрать при</label><div class="themed-input-suffix"><input id="themed-target" data-themed-input type="number" min="${FLIGHT_MIN_AUTO_CASHOUT}" max="${FLIGHT_MAX_MULTIPLIER}" step="0.01" value="2.00"><span>×</span></div><div class="themed-presets"><button type="button" data-flight-target="1.5">1,50×</button><button type="button" data-flight-target="2">2×</button><button type="button" data-flight-target="5">5×</button><button type="button" data-flight-target="10">10×</button></div><p class="themed-control-note">Можешь забрать раньше вручную. Если полёт закончится первым, ставка сгорает.</p>`
          : `<label for="themed-risk">Уровень риска</label><select id="themed-risk" data-themed-input>${WHEEL_RISKS.map(risk => `<option value="${risk}" ${risk === 'medium' ? 'selected' : ''}>${riskLabels[risk]}</option>`).join('')}</select><p class="themed-control-note" id="themed-risk-note"></p>`}
        <div class="themed-odds"><span>RTP <strong>98%</strong></span><span>${flight ? 'Цель' : 'Секторов'} <strong id="themed-odds-value">${flight ? '2,00×' : '50'}</strong></span></div>
        <button type="button" id="themed-play" class="themed-play">${flight ? 'Начать полёт' : 'Вращать колесо'}</button><button type="button" id="themed-refresh" class="themed-secondary" hidden>Восстановить полёт</button><p class="themed-demo-note">Бесплатные демомонеты</p>
        <p class="themed-close-note">${flight ? 'Окно можно закрыть. Полёт продолжится, сервер заберёт выплату на выбранной цели, если полёт её достигнет.' : 'Результат определяет сервер до анимации. Закрытие окна не отменяет ставку.'}</p></aside></div>
      <div id="themed-result" class="themed-result" role="status" aria-live="polite">${this.message}</div>
      ${flight ? '' : '<section class="themed-paytable-wrap" aria-label="Таблица выплат"><span class="themed-label">Начисление и вероятность</span><div id="themed-paytable" class="themed-paytable"></div></section>'}
      <section class="themed-history-wrap" aria-label="История этой игры"><span class="themed-label">Подтверждённые ставки</span><div id="themed-history" class="themed-history"></div></section>
      <details class="themed-rules"><summary>Правила и выплаты</summary><p>${flight ? 'Множитель растёт во время полёта. Нажми «Забрать» до его завершения или выбери автоматическую цель от 1,10× до 100×. Успешное получение выигрыша подтверждает сервер. Множитель на экране показывает последнее подтверждённое состояние и обновляется примерно раз в секунду. При потере связи показания останавливаются, автоматическая цель сохраняется.' : 'Колесо содержит 50 одинаковых по размеру секторов. Каждый сектор выпадает с вероятностью 2%. Риск меняет только таблицу выплат. Указатель всегда показывает сектор, выбранный сервером. Суммарный RTP для каждого риска равен 98%.'}</p><p>Множитель показывает полное начисление, включая возврат ставки. Показанная возможная выплата ещё не является начислением. Выплата округляется вниз до сотой монеты. Это игры на виртуальные монеты.</p></details>`;
    container.replaceChildren(this.root);
    this.art = new ThemedGameArt(this.element<HTMLCanvasElement>('#themed-canvas'), gameId);
    this.element<HTMLButtonElement>('#themed-play').onclick = () => { void this.play(); };
    this.element<HTMLButtonElement>('#themed-wallet').onclick = () => window.dispatchEvent(new Event('royal-open-wallet'));
    this.element<HTMLButtonElement>('#themed-refresh').onclick = () => { void flightClient.refresh(); };
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-themed-input]').forEach(control => control.addEventListener('input', () => {
      if (this.working) return;
      this.lastRound = undefined; this.localError = ''; this.message = 'Выбери ставку и начинай.'; this.root.dataset.result = 'idle'; this.art.update({ selectedSegment: null }); this.render();
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-flight-target]').forEach(button => button.onclick = () => {
      if (button.disabled) return;
      this.element<HTMLInputElement>('#themed-target').value = button.dataset.flightTarget!; this.render();
    });
    demoWallet.addEventListener('change', this.update); demoWallet.addEventListener('settlement', this.settlement);
    if (flight) { flightClient.addEventListener('change', this.update); flightClient.setAccount(demoWallet.accountId); }
    this.timer = setInterval(() => { if (this.alive && flight && !document.hidden) this.render(); }, 400);
    this.render();
  }
  destroy() {
    this.alive = false; this.epoch++; this.cancelAnimation?.(); clearInterval(this.timer); this.art.destroy();
    demoWallet.removeEventListener('change', this.update); demoWallet.removeEventListener('settlement', this.settlement);
    flightClient.removeEventListener('change', this.update); this.root.remove();
  }
  private element<T extends HTMLElement = HTMLElement>(selector: string) { return this.root.querySelector<T>(selector)!; }
  private amount() { return Number(this.element<HTMLSelectElement>('#themed-bet').value); }
  private risk() { return this.element<HTMLSelectElement>('#themed-risk').value as WheelRisk; }
  private ownWheelPending() { return demoWallet.pending?.kind === 'play' && demoWallet.pending.gameId === 'royal-wheel'; }
  private render() {
    if (!this.alive) return;
    const flight = this.gameId === 'royal-flight', session = flight ? flightClient.session : null, active = session?.state === 'active';
    const ownPending = flight ? !!flightClient.pending : this.ownWheelPending();
    const busy = this.working || demoWallet.busy || (flight && flightClient.busy);
    const blocked = !!demoWallet.pending && !(!flight && this.ownWheelPending()) || demoWallet.hasExternalBusy(flight ? 'flight' : undefined);
    if (flight && (active || flightClient.pending?.action === 'start')) {
      const start = flightClient.pending?.action === 'start' ? flightClient.pending : session!;
      this.element<HTMLSelectElement>('#themed-bet').value = String(start.amount);
      this.element<HTMLInputElement>('#themed-target').value = String(start.autoCashout);
    } else if (!flight && this.ownWheelPending()) {
      const pending = demoWallet.pending;
      if (pending?.kind === 'play' && 'risk' in pending.input && WHEEL_RISKS.includes(pending.input.risk as WheelRisk)) {
        this.element<HTMLSelectElement>('#themed-bet').value = String(pending.amount);
        this.element<HTMLSelectElement>('#themed-risk').value = pending.input.risk;
      }
    }
    this.element('#themed-balance').textContent = demoWallet.wallet ? coins(demoWallet.wallet.balance) : '…';
    this.root.dataset.working = String(this.working); this.root.dataset.pending = String(ownPending); this.root.dataset.active = String(!!active);
    const locked = busy || blocked || ownPending || !!active;
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('[data-themed-input], [data-flight-target]').forEach(control => { control.disabled = locked; });
    this.element<HTMLButtonElement>('#themed-wallet').disabled = !demoWallet.accountId || busy || blocked || ownPending;
    const play = this.element<HTMLButtonElement>('#themed-play');
    const target = flight ? this.element<HTMLInputElement>('#themed-target') : undefined;
    const valid = !target || target.checkValidity();
    play.textContent = busy ? 'Подтверждаем…' : ownPending ? flight ? 'Проверить полёт' : 'Проверить результат'
      : active ? 'Забрать' : flight ? 'Начать полёт' : 'Вращать колесо';
    play.disabled = busy || blocked || !demoWallet.accountId
      || (!ownPending && (!valid || !demoWallet.wallet || (!active && demoWallet.wallet.balance < this.amount())
        || (flight && (!flightClient.ready || (!!active && !flightClient.isFresh())))));
    play.classList.toggle('is-cashout', !!active && !ownPending);
    const refresh = this.element<HTMLButtonElement>('#themed-refresh');
    refresh.hidden = !flight || flightClient.ready || !!flightClient.pending || !demoWallet.accountId;
    refresh.disabled = flightClient.loading || flightClient.busy; refresh.textContent = flightClient.loading ? 'Восстанавливаем…' : 'Восстановить полёт';
    let message = flight ? this.renderFlight() : this.message;
    if (!flight) this.renderWheel();
    if (!demoWallet.accountId) message = 'Войди в онлайн-зал, чтобы играть на демомонеты.';
    else if (ownPending) message = (flight ? flightClient.error : demoWallet.error) || 'Операция ожидает подтверждения. Проверь её перед следующей ставкой.';
    else if (blocked) message = 'Сначала проверь предыдущую операцию в её игре или кошельке.';
    else if (flight && flightClient.error) message = flightClient.error;
    if (!busy && !ownPending && !blocked && this.localError) message = this.localError;
    if (demoWallet.accountId && !busy && !blocked && !ownPending && !active && demoWallet.wallet && demoWallet.wallet.balance < this.amount()) message = 'Недостаточно демомонет. Нажми + у баланса или уменьши ставку.';
    if (!valid && !locked) message = `Укажи цель от ${mult(FLIGHT_MIN_AUTO_CASHOUT)} до ${mult(FLIGHT_MAX_MULTIPLIER)} с точностью до 0,01.`;
    this.element('#themed-result').textContent = message;
    this.renderHistory();
  }
  private renderFlight() {
    const session = flightClient.session, active = session?.state === 'active';
    const stale = active && (!flightClient.isFresh() || !!flightClient.pending);
    this.root.dataset.result = session?.state === 'lost' ? 'loss' : session?.state === 'cashed_out' ? 'win' : 'idle';
    const phase = stale ? 'pending' : active ? 'active' : session?.state === 'lost' ? 'crashed' : session?.state === 'cashed_out' ? 'cashed_out' : 'idle';
    this.art.update({ phase, multiplier: session?.multiplier ?? 1 });
    this.element('#themed-multiplier').textContent = mult(session?.multiplier ?? 1);
    this.element('#themed-odds-value').textContent = mult(Number(this.element<HTMLInputElement>('#themed-target').value) || 2);
    this.element('#themed-scene-status').textContent = stale ? 'ОЖИДАЕМ СЕРВЕР' : active ? 'ПОЛЁТ ПРОДОЛЖАЕТСЯ' : session?.state === 'lost' ? 'ПОЛЁТ ЗАВЕРШЁН' : session?.state === 'cashed_out' ? 'ВЫПЛАТА ПОДТВЕРЖДЕНА' : 'ГОТОВ К СТАРТУ';
    this.element('#themed-flight-value').textContent = active
      ? stale ? 'Показано последнее подтверждённое состояние' : `Сейчас можно забрать ${coins(session.cashoutValue)} монет`
      : session?.state === 'cashed_out' ? `Начислено ${coins(session.payout)} монет` : session?.state === 'lost' ? 'Без выплаты' : 'Выбери цель и отправляйся в полёт';
    if (session && session.state !== 'active') {
      const soundKey = `${session.id}:${session.state}`;
      if (this.lastFlightSound && this.lastFlightSound !== soundKey) gameAudio.effect(session.state === 'lost' ? 'crash' : 'win');
      this.lastFlightSound = soundKey;
      return session.state === 'lost' ? `Полёт завершился на ${mult(session.multiplier)}. Без выплаты.` : `${session.reason === 'auto' ? 'Автоматическая цель достигнута.' : 'Выплата подтверждена.'} Начислено ${coins(session.payout)} монет · ${mult(session.multiplier)}`;
    }
    if (active) { this.lastFlightSound = `${session.id}:active`; return stale ? 'Связь с сервером проверяется. Показания приостановлены, автоматическая цель сохраняется.' : 'Можно забрать вручную. Выплату подтверждает сервер в момент получения запроса.'; }
    return flightClient.error || (!flightClient.ready ? 'Проверяем незавершённый полёт…' : this.message);
  }
  private renderWheel() {
    const risk = this.lastRound?.input.risk ?? this.risk(), table = WHEEL_MULTIPLIERS[risk];
    this.art.update({ multipliers: table, rotation: this.rotation, selectedSegment: this.working ? null : this.lastRound?.outcome.segment ?? null });
    if (!this.lastRound && !this.working) {
      this.element('#themed-wheel-value').textContent = 'ВОЗМОЖНОСТЬ НА КАЖДОМ ПОВОРОТЕ';
      this.element('#themed-scene-status').textContent = '50 РАВНЫХ СЕКТОРОВ';
    }
    this.element('#themed-risk-note').textContent = risk === 'high' ? 'Один золотой сектор: 49×. Остальные 49 секторов без выплаты.' : risk === 'medium' ? 'Половина секторов без выплаты. Золотые секторы дают до 5×.' : 'Большинство секторов возвращает ставку. Максимальное начисление 1,80×.';
    const paytable = this.element('#themed-paytable'); paytable.replaceChildren();
    const counts = new Map<number, number>(); for (const value of table) counts.set(value, (counts.get(value) ?? 0) + 1);
    for (const [value, count] of [...counts].sort((a, b) => a[0] - b[0])) {
      const chip = document.createElement('div'); chip.className = 'themed-paytable-chip'; chip.dataset.multiplier = String(value);
      const amount = document.createElement('strong'), chance = document.createElement('span'); amount.textContent = mult(value); chance.textContent = `${count * 2}% · ${count} из 50`;
      chip.append(amount, chance); paytable.append(chip);
    }
  }
  private renderHistory() {
    const groups = new Map<string, { id: number; stake?: number; payout?: number }>();
    for (const entry of demoWallet.wallet?.entries ?? []) {
      if (entry.source !== this.gameId) continue;
      const item = groups.get(entry.operationId) ?? { id: entry.id }; item.id = Math.max(item.id, entry.id);
      if (entry.kind === 'bet') item.stake = (item.stake ?? 0) - entry.amount;
      if (entry.kind === 'win') item.payout = (item.payout ?? 0) + entry.amount;
      groups.set(entry.operationId, item);
    }
    const container = this.element('#themed-history'); container.replaceChildren();
    for (const item of [...groups.values()].filter(item => item.stake !== undefined || item.payout !== undefined).sort((a, b) => b.id - a.id).slice(0, 6)) {
      const chip = document.createElement('div'); chip.className = 'themed-history-chip';
      if (item.stake !== undefined && item.payout !== undefined) chip.dataset.result = item.payout >= item.stake ? 'win' : 'loss';
      const stake = document.createElement('span'), payout = document.createElement('strong');
      stake.textContent = item.stake === undefined ? 'Ставка вне текущей истории' : `Ставка ${coins(item.stake)}`;
      payout.textContent = item.payout === undefined ? 'Игра начата' : `${coins(item.payout)} монет`; chip.append(stake, payout); container.append(chip);
    }
    if (!container.childElementCount) container.textContent = 'Здесь появятся подтверждённые результаты.';
  }
  private async play() {
    if (this.working || this.element<HTMLButtonElement>('#themed-play').disabled) return;
    const epoch = this.epoch; this.working = true; this.localError = ''; this.message = 'Сервер подтверждает операцию…';
    if (this.gameId === 'royal-wheel') { this.lastRound = undefined; this.root.dataset.result = 'idle'; this.art.update({ selectedSegment: null }); }
    this.render();
    void gameAudio.unlock();
    try {
      if (this.gameId === 'royal-flight') {
        const session = flightClient.session;
        await (flightClient.pending ? flightClient.retry() : session?.state === 'active' ? flightClient.act({ action: 'cashout', sessionId: session.id })
          : flightClient.act({ action: 'start', amount: this.amount(), autoCashout: Number(this.element<HTMLInputElement>('#themed-target').value) }));
        if (this.alive && epoch === this.epoch && flightClient.session?.state === 'active') gameAudio.effect('start');
      } else {
        const result = await (this.ownWheelPending() ? demoWallet.retry() : demoWallet.play('royal-wheel', { risk: this.risk() }, this.amount()));
        if (this.alive && epoch === this.epoch && result.gameRound?.gameId === 'royal-wheel') await this.showWheel(result.gameRound, true);
      }
    } catch (error) { if (this.alive && epoch === this.epoch) this.localError = error instanceof Error ? error.message : 'Не удалось подтвердить результат.'; }
    finally { if (this.alive && epoch === this.epoch) { this.working = false; this.render(); } }
  }
  private async showWheel(round: WheelRound, animate: boolean) {
    if (!this.alive || round.gameId !== 'royal-wheel') return;
    const epoch = this.epoch;
    this.lastRound = round; this.element<HTMLSelectElement>('#themed-risk').value = round.input.risk;
    this.art.update({ multipliers: WHEEL_MULTIPLIERS[round.input.risk], selectedSegment: null });
    const from = this.rotation, target = wheelLandingRotation(from, round.outcome.segment);
    this.message = 'Результат подтверждён. Колесо останавливается…';
    this.element('#themed-scene-status').textContent = animate ? 'КОЛЕСО ВРАЩАЕТСЯ' : 'РЕЗУЛЬТАТ ПОДТВЕРЖДЁН';
    await this.animate(animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 3400 : 0, progress => {
      this.rotation = from + (target - from) * (1 - Math.pow(1 - progress, 5)); this.art.update({ rotation: this.rotation });
    });
    if (!this.alive || epoch !== this.epoch) return;
    this.rotation = target % (Math.PI * 2); this.art.update({ rotation: this.rotation, selectedSegment: round.outcome.segment });
    const payout = Number(round.payoutUnits) / 100, stake = Number(round.stakeUnits) / 100;
    this.root.dataset.result = payout >= stake ? 'win' : 'loss';
    this.element('#themed-wheel-value').textContent = `${mult(round.multiplier)} · ${coins(payout)} монет`;
    this.element('#themed-scene-status').textContent = 'РЕЗУЛЬТАТ ПОДТВЕРЖДЁН';
    this.message = payout > 0 ? `Начислено ${coins(payout)} монет · ${mult(round.multiplier)}. Сектор ${round.outcome.segment + 1} из 50.` : `Без выплаты. Ставка ${coins(stake)} монет. Сектор ${round.outcome.segment + 1} из 50.`;
    if (animate) gameAudio.effect(payout >= stake ? 'win' : 'lose'); this.render();
  }
  private animate(duration: number, draw: (progress: number) => void) {
    return new Promise<void>(resolve => {
      const start = performance.now(); let frame = 0, finished = false;
      const end = () => { if (finished) return; finished = true; cancelAnimationFrame(frame); this.cancelAnimation = undefined; resolve(); };
      this.cancelAnimation?.(); this.cancelAnimation = end;
      const tick = (now: number) => {
        if (!this.alive) { end(); return; }
        const progress = duration ? Math.min(1, (now - start) / duration) : 1; draw(progress);
        if (progress === 1) end(); else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
  }
}
