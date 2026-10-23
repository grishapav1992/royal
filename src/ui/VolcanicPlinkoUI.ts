import { t as translateText, tr, locale } from '../i18n/index';
import './volcanic-plinko.css';
import { demoWallet, type WalletClient, type WalletSettlement } from '../wallet/WalletClient';
import { DEMO_BETS } from '../shared/demoWallet';
import type { PlinkoRound } from '../shared/gameCore';
import { gameAudio } from '../game/GameAudio';
import { VolcanicPlinkoAudio } from '../game/VolcanicPlinkoAudio';
import { VolcanicPlinkoBoard } from './VolcanicPlinkoBoard';
import { VesperaPortrait } from './VesperaPortrait';
import { VESPERA_POSTER } from './vesperaMedia';
import { VOLCANIC_PROFILES, VOLCANIC_RISKS, volcanicTable, volcanicRtp, validVolcanicRound, type VolcanicRisk } from './volcanicPlinkoModel';
import { emitGameOutcome } from './gameReactions';

const number = (value: number) => value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const multi = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 }) + '×';
const units = (value: string) => number(Number(value) / 100);
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Visual replacement for royal-plinko. The existing wallet and vFair engine retain ownership of every round. */
export class VolcanicPlinkoUI {
  private root = document.createElement('section');
  private wallet: WalletClient;
  private board: VolcanicPlinkoBoard;
  private portrait: VesperaPortrait;
  private audio = new VolcanicPlinkoAudio();
  private risk: VolcanicRisk = 'easy';
  private betIndex = 1;
  private fast = false;
  private entered: boolean;
  private submitting = false;
  private animating = false;
  private dead = false;
  private failedVerification = false;
  private account: string | null;
  private revision = 0;
  private last?: PlinkoRound;
  private message = translateText('Заклинание ждёт тебя.');
  private selection: number | null = null;
  private seen = new Set<string>();
  private media = matchMedia('(prefers-reduced-motion: reduce)');
  private preferenceStop: () => void;
  private abort = new AbortController();

  constructor(host: HTMLElement, options: { wallet?: WalletClient; skipIntro?: boolean } = {}) {
    this.wallet = options.wallet ?? demoWallet; this.account = this.wallet.accountId; this.entered = !!options.skipIntro;
    this.root.className = 'volcanic-plinko'; this.root.dataset.game = 'royal-plinko'; this.root.dataset.result = 'idle'; this.root.setAttribute('aria-label', translateText('Завеса ночи · Plinko'));
    this.root.innerHTML = tr`<header class="vp-header"><div class="vp-wordmark"><span class="vp-brand-seal" aria-hidden="true">☾</span><span>VEIL <i>OF</i> <b>NIGHT</b><small>ЗАВЕСА НОЧИ · ARCANE PLINKO</small></span></div><span class="vp-tagline">Магия любит смелых.</span><nav aria-label="Меню Plinko"><button type="button" data-vp="sound" class="vp-icon" aria-label="Звук" aria-pressed="true">♫</button><button type="button" data-vp="history" class="vp-icon" aria-label="История ставок">↶</button><button type="button" data-vp="rules" class="vp-icon" aria-label="Правила и выплаты">i</button></nav></header>
      <div class="vp-field"><aside class="vp-mage-panel"><div class="vp-chapter"><span>ХРАНИТЕЛЬНИЦА ЗАВЕСЫ</span><i>✦</i></div><figure class="vp-sorceress"><button type="button" class="vp-character" data-vp="portrait" aria-label="Позвать Весперу"><img src="${VESPERA_POSTER}" decoding="async" fetchpriority="high" alt="Взрослая черноволосая магичка в чёрном платье с фиолетовой магией" draggable="false"></button><figcaption><small>THE SORCERESS</small><strong>ВЕСПЕРА</strong><span>«У каждого падения есть своя судьба»</span></figcaption></figure><div class="vp-mage-sigil" aria-hidden="true">☾ <span>✦</span> ☽</div></aside><div class="vp-ritual"><div class="vp-flight-caption"><span>Выбери силу чар. Пробуди магическую сферу.</span><b>12 РУН · 13 ПЕЧАТЕЙ</b></div><div class="vp-profiles" role="group" aria-label="Уровень риска">${VOLCANIC_RISKS.map(risk => tr`<button type="button" data-risk="${risk}" aria-pressed="${risk === this.risk}"><span class="vp-profile-gem">${risk === 'easy' ? '☽' : risk === 'medium' ? '✧' : '☾'}</span><strong>${translateText(VOLCANIC_PROFILES[risk].name)}<small>${translateText(VOLCANIC_PROFILES[risk].risk)} риск</small></strong><span>до ${multi(VOLCANIC_PROFILES[risk].max)}</span></button>`).join('')}</div><div class="vp-board-space"><div class="vp-board"><canvas aria-label="Магический круг, 12 рядов рун" role="img"></canvas><div class="vp-pockets" role="group" aria-label="Множители лунок"></div></div></div><div class="vp-pocket-info"><span data-vp="pocket-info">Коснись печати, чтобы узнать её силу</span><button type="button" data-vp="paytable">КНИГА ЧИСЕЛ ↗</button></div></div></div>
      <div class="vp-result" role="status" aria-live="polite"><strong data-vp="result">Заклинание ждёт тебя.</strong><span data-vp="result-amount"></span><small data-vp="result-detail">Одна сфера · Одна ставка</small></div>
      <footer class="vp-controls"><div class="vp-balance"><small>USDT · NILE</small><strong data-vp="balance">…</strong><button type="button" data-vp="refresh" aria-label="Обновить баланс">↻</button></div><div class="vp-stake"><small>СТАВКА</small><div><button type="button" data-vp="minus" aria-label="Уменьшить ставку">−</button><output data-vp="stake">50,00</output><button type="button" data-vp="plus" aria-label="Увеличить ставку">+</button></div></div><button type="button" class="vp-drop" data-vp="drop">✧ ПРОБУДИТЬ СФЕРУ</button><button type="button" class="vp-speed" data-vp="speed" aria-pressed="false">ОБЫЧНО<br><b>1×</b></button><p class="vp-wallet-note" data-vp="wallet-note"></p></footer>
      <section class="vp-intro" ${this.entered ? 'hidden' : ''} aria-label="Вход в святилище"><div class="vp-intro-art"><div class="vp-intro-moon" aria-hidden="true">☾</div><button type="button" class="vp-character" data-vp="portrait" aria-label="Позвать Весперу"><img src="${VESPERA_POSTER}" decoding="async" fetchpriority="high" alt="Веспера, хранительница ночной магии" draggable="false"></button></div><div class="vp-intro-copy"><small>ROYAL · ARCANE PLINKO</small><h1>За завесой ночи<br>правит магия.</h1><p>12 рун. 13 печатей.<br>Три силы одного заклинания.</p><button type="button" class="vp-enter" data-vp="enter">ПРИОТКРЫТЬ ЗАВЕСУ <span>↗</span></button><span>Общий баланс USDT клуба</span></div></section>
      <dialog class="vp-modal" aria-label="Правила и выплаты"><button type="button" class="vp-modal-close" data-vp="close" aria-label="Закрыть панель">×</button><div data-vp="modal-content"></div></dialog>`;
    host.replaceChildren(this.root);
    // This new label also works with a host whose shared dictionary predates it.
    this.root.querySelectorAll('[data-vp="portrait"]').forEach(portrait => portrait.setAttribute('aria-label', locale.startsWith('en') ? 'Call Vespera' : 'Позвать Весперу'));
    this.portrait = new VesperaPortrait(this.el('.vp-intro .vp-character'), this.el('.vp-sorceress .vp-character'), !this.entered);
    if (this.entered) this.portrait.react('enter');
    this.board = new VolcanicPlinkoBoard(this.el<HTMLCanvasElement>('canvas'), (row, x) => this.audio.hit(row, x), () => this.media.matches);
    const signal = this.abort.signal;
    this.root.addEventListener('click', this.click, { signal });
    this.wallet.addEventListener('change', this.update, { signal }); this.wallet.addEventListener('settlement', this.settlement, { signal });
    document.addEventListener('visibilitychange', this.visibility, { signal }); this.media.addEventListener('change', this.motion, { signal });
    this.preferenceStop = gameAudio.onPreferences(p => { this.el<HTMLButtonElement>('[data-vp="sound"]').setAttribute('aria-pressed', String(!p.muted)); this.el('[data-vp="sound"]').textContent = p.muted ? '♪' : '♫'; });
    this.restorePending(); this.renderPockets(); this.update(); void this.wallet.refresh();
  }
  private el<T extends HTMLElement = HTMLElement>(selector: string) { return this.root.querySelector<T>(selector)!; }
  private get stake() { return DEMO_BETS[this.betIndex]; }
  private get locked() { return this.submitting || this.animating || this.wallet.busy || this.wallet.externalBusy || !!this.wallet.pending; }
  private get ownPending() { const p = this.wallet.pending; return p?.kind === 'play' && p.gameId === 'royal-plinko' ? p : undefined; }
  private restorePending() {
    const pending = this.ownPending; if (!pending) return;
    const index = DEMO_BETS.findIndex(value => value === pending.amount); if (index >= 0) this.betIndex = index;
    const risk = 'risk' in pending.input ? pending.input.risk : undefined;
    if (VOLCANIC_RISKS.includes(risk as VolcanicRisk)) this.risk = risk as VolcanicRisk;
  }
  private update = () => {
    if (this.dead) return;
    if (this.account !== this.wallet.accountId) {
      this.account = this.wallet.accountId; this.revision++; this.last = undefined; this.seen.clear(); this.failedVerification = false;
      this.root.dataset.result = 'idle';
      this.animating = this.submitting = false; this.message = translateText('Заклинание ждёт тебя.'); this.audio.cancel(); this.board.reset(); this.selection = null;
      this.el('[data-vp="result-amount"]').textContent = ''; this.el('[data-vp="result-detail"]').textContent = translateText('Одна сфера · Одна ставка');
      this.el<HTMLDialogElement>('.vp-modal').close(); this.renderPockets();
    }
    this.restorePending();
    const locked = this.locked, ownPending = !!this.ownPending, wallet = this.wallet.wallet;
    this.root.dataset.state = this.animating ? 'falling' : this.submitting || this.wallet.busy ? 'confirming' : ownPending ? 'pending' : 'ready';
    this.el('[data-vp="balance"]').textContent = wallet ? number(wallet.balance) : '…'; this.el('[data-vp="stake"]').textContent = number(this.stake);
    this.el<HTMLButtonElement>('[data-vp="minus"]').disabled = locked || this.betIndex === 0;
    this.el<HTMLButtonElement>('[data-vp="plus"]').disabled = locked || this.betIndex === DEMO_BETS.length - 1;
    this.el<HTMLButtonElement>('[data-vp="refresh"]').disabled = locked || !this.account;
    this.el<HTMLButtonElement>('[data-vp="speed"]').disabled = locked;
    this.root.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(button => { button.disabled = locked; button.setAttribute('aria-pressed', String(button.dataset.risk === this.risk)); });
    const drop = this.el<HTMLButtonElement>('[data-vp="drop"]');
    drop.textContent = this.animating ? translateText('СФЕРА В ПОЛЁТЕ…') : this.submitting || this.wallet.busy ? translateText('ПОДТВЕРЖДАЕМ…') : ownPending ? translateText('ПРОВЕРИТЬ РЕЗУЛЬТАТ') : translateText('✧ ПРОБУДИТЬ СФЕРУ');
    drop.disabled = !this.entered || this.submitting || this.animating || this.wallet.busy || this.wallet.externalBusy || !this.account || !!this.wallet.pending && !ownPending || this.failedVerification || !ownPending && (!wallet || wallet.balance < this.stake);
    this.el('[data-vp="result"]').textContent = this.animating ? translateText('Сфера проходит сквозь завесу…') : this.submitting ? translateText('Пробуждаем заклинание…') : this.message;
    const note = this.el('[data-vp="wallet-note"]');
    note.textContent = !this.account ? translateText('Войди в аккаунт клуба, чтобы играть') : translateText(this.wallet.error).replace(translateText('Проверить операцию'), translateText('Проверить результат')) || (ownPending ? translateText('Проверь прежний запрос. Повторного списания не будет.') : wallet && wallet.balance < this.stake ? translateText('Пополни баланс USDT в кошельке клуба') : '');
    note.hidden = !note.textContent;
    for (const selector of ['.vp-header', '.vp-field', '.vp-result', '.vp-controls']) this.el(selector).inert = !this.entered;
    this.updatePocketInfo();
  };
  private renderPockets() {
    const table = volcanicTable(this.risk);
    this.el('.vp-pockets').innerHTML = table.map((value, index) => tr`<button type="button" data-pocket="${index}" class="${value >= 1 ? 'vp-hot' : 'vp-cool'}" aria-label="Лунка ${index + 1}: ${multi(value)}, выплата ${number(this.stake * value)}" aria-pressed="false">${multi(value)}</button>`).join('');
  }
  private updatePocketInfo() {
    const table = volcanicTable(this.risk);
    this.root.querySelectorAll<HTMLButtonElement>('[data-pocket]').forEach((button, index) => { button.setAttribute('aria-label', tr`Лунка ${index + 1}: ${multi(table[index])}, выплата ${number(this.stake * table[index])}`); button.setAttribute('aria-pressed', String(index === this.selection)); });
    this.el('[data-vp="pocket-info"]').textContent = this.selection === null ? translateText('Коснись печати, чтобы узнать её силу') : tr`Лунка ${this.selection + 1} · ${multi(table[this.selection])} · выплата ${number(this.stake * table[this.selection])}`;
  }
  private click = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
    if (button.dataset.risk && !this.locked) {
      this.risk = button.dataset.risk as VolcanicRisk; this.last = undefined; this.root.dataset.result = 'idle'; this.message = translateText('Профиль выбран. Заклинание ждёт тебя.'); this.selection = null;
      this.el('[data-vp="result-amount"]').textContent = ''; this.el('[data-vp="result-detail"]').textContent = translateText('Одна сфера · Одна ставка'); this.board.reset(); this.renderPockets(); this.update(); return;
    }
    if (button.dataset.pocket !== undefined) { this.selection = Number(button.dataset.pocket); this.updatePocketInfo(); return; }
    switch (button.dataset.vp) {
      case 'enter': this.entered = true; this.el('.vp-intro').hidden = true; this.portrait.setIntro(false); this.portrait.react('enter'); void this.audio.unlock(); this.update(); this.el('[data-vp="drop"]').focus(); break;
      case 'portrait': this.portrait.react('touch'); break;
      case 'drop': void this.drop(); break;
      case 'minus': if (!this.locked && this.betIndex > 0) { this.betIndex--; this.update(); } break;
      case 'plus': if (!this.locked && this.betIndex < DEMO_BETS.length - 1) { this.betIndex++; this.update(); } break;
      case 'sound': gameAudio.setMuted(!gameAudio.getPreferences().muted); void this.audio.unlock(); break;
      case 'speed': if (!this.locked) { this.fast = !this.fast; button.setAttribute('aria-pressed', String(this.fast)); button.innerHTML = this.fast ? translateText('БЫСТРО<br><b>2×</b>') : translateText('ОБЫЧНО<br><b>1×</b>'); } break;
      case 'refresh': void this.wallet.refresh(); break;
      case 'rules': case 'paytable': this.panel('rules'); break;
      case 'history': this.panel('history'); break;
      case 'close': this.el<HTMLDialogElement>('.vp-modal').close(); break;
    }
  };
  private async drop() {
    if (this.dead || this.submitting || this.animating || !this.entered || this.el<HTMLButtonElement>('[data-vp="drop"]').disabled) return;
    const revision = this.revision, account = this.account;
    const pending = this.ownPending, requested = pending ?? { id: '', amount: this.stake, input: { rows: 12, risk: this.risk } };
    this.submitting = true; this.message = ''; this.audio.cancel(); this.board.reset();
    this.root.querySelectorAll('.vp-landed').forEach(button => button.classList.remove('vp-landed'));
    this.el('[data-vp="result-amount"]').textContent = ''; this.el('[data-vp="result-detail"]').textContent = translateText('Одна сфера · Одна ставка'); this.update(); void this.audio.unlock();
    try {
      const result = pending ? await this.wallet.retry() : await this.wallet.play('royal-plinko', { rows: 12, risk: this.risk }, this.stake);
      if (this.dead || revision !== this.revision || account !== this.wallet.accountId) return;
      const round = result.gameRound;
      if (!validVolcanicRound(round) || Number(round.stakeUnits) !== requested.amount * 100 || !('rows' in requested.input) || !('risk' in requested.input) || round.input.rows !== requested.input.rows || round.input.risk !== requested.input.risk) {
        this.failedVerification = true; throw new Error(translateText('Не удалось проверить результат. Обнови страницу перед следующей ставкой.'));
      }
      await this.showRound(round, true);
    } catch (error) {
      if (!this.dead && revision === this.revision) this.message = error instanceof Error ? translateText(error.message).replace(translateText('Проверить операцию'), translateText('Проверить результат')) : translateText('Не удалось получить результат. Проверь операцию.');
    } finally { if (!this.dead && revision === this.revision) { this.submitting = false; this.update(); } }
  }
  private settlement = (event: Event) => {
    const { accountId, operation, result } = (event as CustomEvent<WalletSettlement>).detail;
    if (this.dead || accountId !== this.account || operation.kind !== 'play' || operation.gameId !== 'royal-plinko' || this.seen.has(operation.id)) return;
    if (this.submitting || this.animating) { this.seen.add(operation.id); return; }
    if (validVolcanicRound(result.gameRound)) { this.seen.add(operation.id); void this.showRound(result.gameRound, this.entered).catch(() => { this.message = translateText('Результат сохранён. Обнови баланс.'); this.animating = false; this.update(); }); }
  };
  private async showRound(round: PlinkoRound, animate: boolean) {
    const revision = this.revision;
    const supported = round.input.rows === 12 && VOLCANIC_RISKS.includes(round.input.risk as VolcanicRisk);
    if (supported) { this.risk = round.input.risk as VolcanicRisk; this.renderPockets(); }
    this.last = round; this.animating = true; this.update();
    if (animate && supported) { this.audio.launch(); await this.board.play(round.outcome.path, this.fast); }
    if (this.dead || revision !== this.revision) return;
    this.animating = false;
    const profit = BigInt(round.payoutUnits) - BigInt(round.stakeUnits);
    this.message = profit > 0n ? round.multiplier >= 10 ? translateText('СИЛА ЗАТМЕНИЯ!') : translateText('Магия на твоей стороне!') : profit === 0n ? translateText('Ставка вернулась.') : translateText('Заклинание завершено.');
    this.el('[data-vp="result-amount"]').textContent = `${multi(round.multiplier)} · ${units(round.payoutUnits)}`;
    this.el('[data-vp="result-detail"]').textContent = tr`${profit >= 0n ? '+' : '−'}${units(String(profit < 0n ? -profit : profit))} к балансу${supported ? '' : tr` · прежняя партия, ${round.input.rows} рядов`}`;
    if (supported) this.root.querySelector(`[data-pocket="${round.outcome.bucket}"]`)?.classList.add('vp-landed');
    this.root.dataset.result = profit > 0n ? 'win' : profit < 0n ? 'loss' : 'even';
    if (animate && this.entered) { this.audio.land(round.multiplier); this.portrait.react('win', round.multiplier); emitGameOutcome(this.root, round.stakeUnits, round.payoutUnits); }
    this.update();
  }
  private panel(kind: 'rules' | 'history') {
    const content = this.el('[data-vp="modal-content"]');
    if (kind === 'rules') {
      const tables = VOLCANIC_RISKS.map(volcanicTable);
      content.innerHTML = tr`<small>VEIL OF NIGHT · ROYAL</small><h2>Правила и выплаты</h2><p>Один шар проходит 12 рядов. Каждый поворот влево или вправо имеет вероятность 50%. Лунка определяет полную выплату, включая возвращаемую часть ставки. Выплата меньше ставки означает убыток.</p><p>Профиль меняет таблицу выплат. Скорость, время нажатия и предыдущие броски не меняют шансы. Игра использует общий баланс USDT.</p><div class="vp-table-scroll"><table><caption>Полная выплата при ставке ${number(this.stake)}</caption><thead><tr><th>Лунка</th>${VOLCANIC_RISKS.map(r => `<th>${translateText(VOLCANIC_PROFILES[r].label)}<small>RTP ${(volcanicRtp(r) * 100).toFixed(4)}%</small></th>`).join('')}</tr></thead><tbody>${Array.from({ length: 13 }, (_, i) => `<tr><th>${i + 1}</th>${tables.map(t => `<td>${multi(t[i])}<small>${number(this.stake * t[i])}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div><p>Математика vFair, Apache-2.0. RTP указан до денежного округления. Начисление округляется вниз до 0,01 USDT. Незавершённый запрос восстанавливается с прежним идентификатором.</p>`;
    } else {
      const entries = this.wallet.wallet?.entries ?? [], bets = entries.filter(e => e.kind === 'bet' && e.source === 'royal-plinko').slice(0, 12);
      content.innerHTML = tr`<small>ОБЩИЙ ТЕСТОВЫЙ КОШЕЛЁК</small><h2>История заклинаний</h2><div class="vp-history">${bets.length ? bets.map(bet => { const won = entries.filter(e => e.operationId === bet.operationId && e.kind === 'win').reduce((a, e) => a + e.amount, 0); return tr`<div><span>${escape(new Date(bet.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }))}<small>Ставка ${number(-bet.amount)}</small></span><strong>${number(won)}<small>Выплата</small></strong></div>`; }).join('') : translateText('<p>Здесь появятся подтверждённые ставки этой игры.</p>')}</div><p>Показаны операции, загруженные общим кошельком.</p>`;
    }
    this.el<HTMLDialogElement>('.vp-modal').showModal();
  }
  private visibility = () => { if (document.hidden) this.audio.cancel(); };
  private motion = () => { if (this.media.matches) { this.audio.cancel(); this.board.finish(); } };
  previewPortrait(seconds?: number) { this.portrait.preview(seconds); }
  previewPortraitWin(multiplier: number) { return this.portrait.react('win', multiplier); }
  getState() { return { state: this.dead ? 'closed' : this.root.dataset.state, account: this.account, risk: this.risk, activeSources: this.audio.activeSources, sounds: { ...this.audio.counts }, portrait: this.portrait.getState(), round: this.last }; }
  destroy() { if (this.dead) return; this.dead = true; this.revision++; this.abort.abort(); this.preferenceStop(); this.portrait.destroy(); this.board.destroy(); this.audio.destroy(); this.el<HTMLDialogElement>('.vp-modal').close(); this.root.remove(); }
}
