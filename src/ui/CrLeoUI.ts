import {stakeRulesHtml} from './stakeRules';
import {GAME_STAKE_UNITS as PENALTY_BETS} from '../shared/gameStakes';
import { PENALTY_GAME, PENALTY_RISKS, penaltyPathQuote, type PenaltyHero, type PenaltyRisk, type PenaltyView } from '../shared/crLeo';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { isWallHit } from './crLeoFreeKick';
import { CrLeoScene } from './CrLeoScene';
import { CrLeoAudio } from './CrLeoAudio';
import './cr-leo.css';

const money = (v: string) => (Number(v) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const multiplier = (risks: PenaltyRisk[]) => risks.length ? '≈' + (Number(penaltyPathQuote('1000000', risks)) / 1000000).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×' : '1,00×';
export class CrLeoUI {
  private root = document.createElement('section');
  private scene: CrLeoScene;
  private audio = new CrLeoAudio();
  private hero: PenaltyHero = 'cr';
  private risk: PenaltyRisk = 'safe';
  private stake = '10';
  private seen = '';
  private owner = client.accountId;
  private action = '';
  private error = '';
  private frame = 0;
  private alive = true;
  private shownBalance = '0';
  private selectionPreview = false;
  private controlsKey = '';
  private loadingKey = '';
  private pipsKey = '';
  private epoch = 0;
  private onChange = () => this.sync();
  private onVisibility = () => { if (document.hidden) this.audio.silence(); else { this.scene.skipPastSounds(); void this.audio.unlock(); } };
  constructor(host: HTMLElement, preview?: { hero: PenaltyHero; risk: PenaltyRisk }) {
    if (preview) { this.hero = preview.hero; this.risk = preview.risk; }
    this.root.className = 'cr-leo'; this.root.dataset.loading = 'true'; this.root.setAttribute('aria-label', 'CR vs. Leo');
    this.root.innerHTML = `<header class="cl-header"><div class="cl-brand"><b>CR</b><i>vs.</i><b>Leo</b></div><div class="cl-heading"><span>ДВА ИГРОКА. ОДНА СЕРИЯ.</span><strong>Серия ударов</strong></div><button class="cl-rules" data-rules>Как играть <span>↗</span></button></header>
      <div class="cl-stage"><div class="cl-loader" data-loader><div class="cl-loader-mark" aria-hidden="true">CR <i>vs.</i> <span>Leo</span></div><strong data-load-title>Готовим стадион</strong><div class="cl-loader-meter"><progress max="100" value="0" aria-label="Загрузка игры" data-load-progress></progress><span data-load-percent>0%</span></div><button type="button" data-load-retry hidden>Повторить загрузку</button></div><canvas aria-label="Пенальти на дневном стадионе"></canvas><div class="cl-stadium"><i></i> ДЕНЬ МАТЧА <span data-situation>ПЕНАЛЬТИ · 11 М</span></div><div class="cl-score"><span data-caption>ТВОЯ СЕРИЯ</span><strong data-coefficient>1,00×</strong><small data-award>Пять ударов. Решение после каждого гола.</small></div><div class="cl-moment" data-moment hidden><b data-moment-title></b><span data-moment-detail></span></div><div class="cl-player-label"><span data-hero-name>CR</span><small data-foot>ПРАВАЯ НОГА</small></div><div class="cl-pips" aria-label="Результаты пяти ударов" data-pips></div></div>
      <div class="cl-progress" aria-label="Выплаты по серии" data-progress></div>
      <div class="cl-controls"><div class="cl-choose"><span class="cl-label">ТВОЙ ИГРОК</span><div class="cl-heroes"><button data-hero="cr" aria-pressed="true"><i class="cl-mini cl-mini-cr"></i><span><b>CR</b><small>ПРАВАЯ</small></span><em>07</em></button><button data-hero="leo" aria-pressed="false"><i class="cl-mini cl-mini-leo"></i><span><b>Leo</b><small>ЛЕВАЯ</small></span><em>10</em></button></div></div>
      <div class="cl-risk-panel"><span class="cl-label">ТИП УДАРА <small>ШАНС КАЖДОГО ГОЛА</small></span><div class="cl-risks">${Object.entries(PENALTY_RISKS).map(([id, v]) => `<button data-risk="${id}" aria-pressed="${id === 'safe'}"><b>${v.name}</b><span>${v.chance}%</span></button>`).join('')}</div><p data-hint>Игрок на всю серию. Риск выбирается перед каждым ударом.</p></div>
      <div class="cl-betting"><div class="cl-bank"><span class="cl-label">USDT · NILE</span><b data-balance>...</b><label>Ставка <select aria-label="Ставка" data-stake>${PENALTY_BETS.map(n => `<option value="${n}">${Number(n) / 100}</option>`).join('')}</select></label></div><div class="cl-actions"><button class="cl-primary" data-shoot>БИТЬ ПЕНАЛЬТИ <span>↗</span></button><button class="cl-take" data-take hidden>ЗАБРАТЬ <b data-take-value></b></button></div></div></div>
      <footer class="cl-footer"><span>Виртуальные USDT · Серия до 5 ударов</span><p role="status" data-status>Выбери своего игрока.</p><button data-sound aria-pressed="true">ЗВУК ON</button></footer><div class="cl-recovery" hidden data-recovery><span>Результат запроса ещё не подтверждён.</span><button data-retry>Проверить ту же операцию</button></div><p class="cl-error" role="alert"></p>
      <dialog class="cl-dialog"><button data-close aria-label="Закрыть правила">×</button><span class="cl-label">CR vs. Leo</span><h2>Пять ударов. Одно решение.</h2><p>Выбери игрока, ставку и риск первого удара. Перед каждым следующим ударом риск можно изменить. Первая кнопка списывает одну ставку и выполняет первый удар. После гола можно забрать всю доступную выплату или рискнуть следующим ударом. Промах теряет ставку и всю незабранную выплату серии. Пятый гол оплачивается автоматически.</p><p>Пенальти: 75% гола. Ближний штрафной со стенкой из пяти игроков: 60%. Дальний штрафной со стенкой из трёх игроков: 45%. CR и Leo имеют одинаковую математику. Сектор ворот выбирается случайно и не меняет шанс гола или выплату. Сила нажатия, скорость реакции и движения игроков не меняют вероятность.</p><p>Коэффициенты на экране приблизительные. Сумма на кнопке показана без долей цента, которые учитываются при завершении серии. Выплата рассчитывается по вероятности всей успешной серии. Расчётный возврат 99%, одинаковый для любого сочетания рисков и любого выбранного момента остановки после гола.</p><p>Между ударами нет таймера. Закрытие окна сохраняет серию. При потере ответа проверяется тот же запрос, новая ставка не создаётся.</p>${stakeRulesHtml()}</dialog>`;
    host.replaceChildren(this.root);
    this.scene = new CrLeoScene(this.find('canvas'), event => { if (!document.hidden) this.audio.event(event, this.hero); });
    this.scene.select(this.hero, this.risk);
    this.root.addEventListener('pointerdown', () => void this.audio.unlock(), { capture: true });
    this.root.addEventListener('keydown', () => void this.audio.unlock(), { capture: true });
    const soundButton = this.find('[data-sound]'); soundButton.textContent = 'ЗВУК ' + (this.audio.enabled ? 'ON' : 'OFF'); soundButton.setAttribute('aria-pressed', String(this.audio.enabled));
    void this.audio.unlock();
    this.find('[data-load-retry]').onclick = () => this.scene.retryAssets();
    this.root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(b => b.onclick = () => { if (this.blocked() || this.active()) return; this.hero = b.dataset.hero as PenaltyHero; this.selectionPreview = true; this.scene.select(this.hero, this.risk); this.syncControls(); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b => b.onclick = () => { if (this.blocked()) return; this.risk = b.dataset.risk as PenaltyRisk; this.scene.chooseRisk(this.risk); if (!this.active()) { this.selectionPreview = true; this.scene.select(this.hero, this.risk); } this.syncControls(); });
    this.find<HTMLSelectElement>('[data-stake]').onchange = e => { if (!this.active() && !this.blocked()) { this.stake = (e.target as HTMLSelectElement).value; this.syncControls(); } };
    this.find('[data-shoot]').onclick = () => void this.send('kick');
    this.find('[data-take]').onclick = () => void this.send('cashout');
    this.find('[data-sound]').onclick = () => { this.audio.toggle(); const b = this.find('[data-sound]'); b.textContent = 'ЗВУК ' + (this.audio.enabled ? 'ON' : 'OFF'); b.setAttribute('aria-pressed', String(this.audio.enabled)); };
    const dialog = this.find<HTMLDialogElement>('dialog'); this.find('[data-rules]').onclick = () => dialog.showModal(); this.find('[data-close]').onclick = () => dialog.close();
    this.find('[data-retry]').onclick = async () => { try { await client.retry(); } catch {} this.sync(); };
    document.addEventListener('visibilitychange', this.onVisibility);
    client.addEventListener('change', this.onChange); demoWallet.addEventListener('change', this.onChange);
    this.sync(); void client.refresh(); this.frame = requestAnimationFrame(t => this.tick(t));
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  private text(selector: string, value: string) { const node = this.find(selector); if (node.textContent !== value) node.textContent = value; }
  private session() { return client.sessions.find(s => s.gameId === PENALTY_GAME); }
  private active() { return this.session()?.state === 'active'; }
  private blocked() { return client.busy || !!client.pending || !!this.action || this.scene.state().busy; }
  private sync() {
    if (!this.alive) return;
    if (this.owner !== client.accountId) { this.owner = client.accountId; this.epoch++; this.seen = ''; this.controlsKey = ''; this.pipsKey = ''; this.action = ''; this.error = ''; this.hero = 'cr'; this.risk = 'safe'; this.stake = '10'; this.scene.select(this.hero, this.risk); }
    const s = this.session(), v = s?.view.penalty, key = s && v ? s.id + ':' + v.revision : '';
    if (v && key !== this.seen) {
      const cashout = this.action === 'cashout';
      this.seen = key; this.hero = v.hero; this.risk = cashout ? this.risk : v.risk; this.stake = s!.stakeUnits; this.selectionPreview = false;
      this.scene.show(v, !!this.action && !document.hidden, cashout);
    }
    this.syncControls();
  }
  private syncControls() {
    const s = this.session(), active = s?.state === 'active', busy = this.blocked(), ready = !!client.accountId && this.scene.ready();
    const key = JSON.stringify([s?.id,s?.view.penalty?.revision,active,this.scene.state().reveal,busy,ready,client.loading,client.pending?.id,client.busy,client.wallet?.balance,this.hero,this.risk,this.stake,this.error,client.error]); if (key === this.controlsKey) return; this.controlsKey = key;
    this.root.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.hero === this.hero)); b.disabled = !!active || busy; });
    this.root.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.risk === this.risk)); b.disabled = busy; });
    const select = this.find<HTMLSelectElement>('[data-stake]'); select.value = this.stake; select.disabled = !!active || busy;
    const shoot = this.find<HTMLButtonElement>('[data-shoot]'); shoot.disabled = busy || !ready || client.loading || !active && Number(this.stake) > (client.wallet?.balance ?? 0) * 100;
    shoot.innerHTML = (!this.scene.state().reveal ? 'МЯЧ В ИГРЕ' : active ? 'СЛЕДУЮЩИЙ УДАР' : s ? 'НОВАЯ СЕРИЯ' : this.risk !== 'safe' ? 'БИТЬ ШТРАФНОЙ' : 'БИТЬ ПЕНАЛЬТИ') + ' <span>↗</span>';
    const take = this.find<HTMLButtonElement>('[data-take]'); take.hidden = !active || !this.scene.state().reveal; take.disabled = busy || !ready;
    this.text('[data-take-value]', s?.view.penalty ? money(s.view.penalty.availableUnits) : '');
    this.text('[data-situation]', this.risk === 'sharp' ? 'БЛИЖНИЙ ШТРАФНОЙ · 20 М' : this.risk === 'safe' ? 'ПЕНАЛЬТИ · 11 М' : 'ДАЛЬНИЙ ШТРАФНОЙ · 30 М');
    this.find('canvas').setAttribute('aria-label',this.risk==='sharp'?'Ближний штрафной со стенкой из пяти игроков':this.risk==='extreme'?'Дальний штрафной со стенкой из трёх игроков':'Удар по воротам на дневном стадионе');
    this.text('[data-hero-name]', this.hero === 'cr' ? 'CR' : 'Leo'); this.text('[data-foot]', this.hero === 'cr' ? 'ПРАВАЯ НОГА' : 'ЛЕВАЯ НОГА');
    const v = this.selectionPreview ? undefined : s?.view.penalty, shots = v?.shots ?? [];
    const confirmed = (this.scene.state().reveal ? shots : shots.slice(0, -1)).filter(s => s.goal).map(s => s.risk ?? v!.risk);
    this.find('[data-progress]').innerHTML = Array.from({ length: 5 }, (_, i) => { const count = i + 1, path = confirmed.slice(0, count); while (path.length < count) path.push(this.risk); return `<div data-step="${count}"><span>${count} ГОЛ${i ? i < 4 ? 'А' : 'ОВ' : ''}</span><b>${multiplier(path)}</b></div>`; }).join('');
    this.text('[data-hint]', !this.scene.state().reveal ? 'Мяч в игре. Дождись завершения удара.' : active ? PENALTY_RISKS[this.risk].chance + '% на следующий гол. Риск можно менять перед ударом.' : 'Игрок на всю серию. Риск выбирается перед каждым ударом.');
    this.find('[data-recovery]').hidden = !client.pending || client.busy;
    this.find<HTMLButtonElement>('[data-retry]').disabled = client.busy || client.loading;
    this.text('.cl-error', this.error || client.error);
  }
  private tick(now: number) {
    if (!this.alive) return;
    const loading = this.scene.loading();
    const loadingKey = JSON.stringify(loading);
    if (loadingKey !== this.loadingKey) {
      this.loadingKey = loadingKey; this.root.dataset.loading = String(!loading.ready);
      this.find('[data-loader]').hidden = loading.ready;
      this.find<HTMLProgressElement>('[data-load-progress]').value = loading.percent;
      this.text('[data-load-percent]', loading.percent + '%');
      this.text('[data-load-title]', loading.failed ? 'Не удалось загрузить графику' : 'Готовим стадион');
      this.find<HTMLButtonElement>('[data-load-retry]').hidden = !loading.failed;
      this.find<HTMLButtonElement>('[data-load-retry]').disabled = loading.loading;
    }
    this.scene.paint(now);
    const state = this.scene.state(now), s = this.session(), v = this.selectionPreview ? undefined : s?.view.penalty;
    const shots = v?.shots ?? [], shown = state.reveal ? shots : shots.slice(0, -1), goals = shown.filter(s => s.goal).length;
    const terminal = !!v && v.status !== 'playing' && state.reveal;
    const paid = terminal && (v.status === 'banked' || v.status === 'complete');
    this.root.dataset.state = s?.state ?? 'idle'; this.root.dataset.revision = String(v?.revision ?? 0); this.root.dataset.hero = this.hero; this.root.dataset.risk = this.risk;
    const successfulRisks = shown.filter(s => s.goal).map(s => s.risk ?? v!.risk);
    this.text('[data-coefficient]', multiplier(successfulRisks));
    this.text('[data-caption]', state.phase === 'shooting' ? 'УДАР ПО ВОРОТАМ' : paid ? 'СЕРИЯ В ТВОЮ ПОЛЬЗУ' : terminal ? 'СЕРИЯ ЗАВЕРШЕНА' : goals ? goals + ' ИЗ 5 · ТВОЙ ВЫБОР' : 'ТВОЯ СЕРИЯ');
    this.text('[data-award]', paid ? 'Выплата ' + money(s!.returnedUnits) + ' · Прибыль +' + money(String(BigInt(s!.returnedUnits)-BigInt(s!.stakeUnits))) : terminal ? 'Выплата 0,00' : goals ? 'Можно забрать ' + money(penaltyPathQuote(this.stake, successfulRisks)) : 'Пять ударов. Решение после каждого гола.');
    const moment = this.find('[data-moment]'); moment.hidden = !v || !state.reveal || !terminal && !state.busy; this.root.dataset.momentVisible = String(!moment.hidden);
    if (!moment.hidden) {
      this.text('[data-moment-title]', paid ? this.hero === 'cr' ? 'SIUUU!' : 'LEO!' : terminal ? isWallHit(shots.at(-1),v?.risk) ? 'СТЕНКА' : shots.at(-1)?.finish === 'save' ? 'СЕЙВ' : shots.at(-1)?.finish === 'post' ? 'ШТАНГА' : 'МИМО' : 'ГОООЛ!');
      this.text('[data-moment-detail]', paid ? 'Выплата ' + money(s!.returnedUnits) + ' USDT' : terminal ? 'Новая серия. Новый шанс.' : 'Продолжить или забрать?');
    }
    const pips = Array.from({ length: 5 }, (_, i) => `<i class="${shown[i] ? shown[i].goal ? 'goal' : 'miss' : i === shots.length - 1 && !state.reveal ? 'current' : ''}" aria-label="${i + 1}: ${shown[i] ? shown[i].goal ? 'гол' : 'промах' : 'ожидается'}">${shown[i] ? shown[i].goal ? '✓' : '×' : String(i + 1)}</i>`).join('');
    if (pips !== this.pipsKey) { this.pipsKey = pips; this.find('[data-pips]').innerHTML = pips; }
    const balance = String(Math.round((client.wallet?.balance ?? 0) * 100)); if (state.reveal) this.shownBalance = balance;
    this.text('[data-balance]', client.wallet ? money(this.shownBalance) : '...');
    this.text('[data-status]', client.busy ? this.action === 'cashout' ? 'Подтверждаем выплату…' : 'Принимаем удар…' : !this.scene.ready() ? 'Готовим стадион…' : state.busy ? state.phase === 'shooting' ? 'Мяч в игре.' : paid ? 'Победа подтверждена.' : terminal ? 'Серия завершена.' : 'Гол подтверждён.' : activeText(v));
    if (Math.floor(now / 100) !== Number(this.root.dataset.controlTick)) { this.root.dataset.controlTick = String(Math.floor(now / 100)); this.root.dataset.audio = JSON.stringify(this.audio.state()); this.syncControls(); }
    this.frame = requestAnimationFrame(t => this.tick(t));
  }
  private async send(move: 'kick' | 'cashout') {
    if (this.blocked() || !this.scene.ready() || !client.accountId || document.hidden) return;
    const s = this.session(), v = s?.view.penalty, active = s?.state === 'active';
    const account = client.accountId, epoch = this.epoch;
    this.error = ''; this.action = move; this.selectionPreview = false; void this.audio.unlock(); this.syncControls();
    try {
      if (active && v) await client.act({ gameId: PENALTY_GAME, action: 'move', sessionId: s.id, revision: v.revision, move: move === 'kick' ? 'penalty-kick' : 'cashout', ...(move === 'kick' ? { penaltyRisk: this.risk } : {}) });
      else if (move === 'kick') await client.act({ gameId: PENALTY_GAME, action: 'start', stakeUnits: this.stake, settings: { penalty: { hero: this.hero, risk: this.risk } } });
    } catch (e) { if (account === client.accountId && epoch === this.epoch) this.error = (e as Error).message; }
    finally { if (this.alive && account === client.accountId && epoch === this.epoch) { this.action = ''; this.sync(); } }
  }
  destroy() { this.alive = false; document.removeEventListener('visibilitychange', this.onVisibility); cancelAnimationFrame(this.frame); client.removeEventListener('change', this.onChange); demoWallet.removeEventListener('change', this.onChange); this.find<HTMLDialogElement>('dialog').close(); this.audio.destroy(); this.scene.destroy(); this.root.remove(); }
}
function activeText(v?: PenaltyView) { return v?.status === 'playing' ? 'Продолжи серию или забери выплату. Время не ограничено.' : 'Выбери игрока и риск. Первая кнопка начинает серию.'; }
