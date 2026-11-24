import { canRecoverOperation } from '../../src/ui/operationFeedback';
import { ActionGameLayout } from '../../src/ui/ActionGameLayout';
import { ROYAL_GAME_STAKE_UNITS } from '../../src/shared/gameStakes';
import { syncStakeSelect } from '../../src/ui/stakeSelection';
import { expansionClient as client, type NewExpansionAction } from '../../src/wallet/ExpansionClient';
import { demoWallet } from '../../src/wallet/WalletClient';
import { observeExpansionOutcome, resetGameOutcomes } from '../../src/ui/gameReactions';
import { gameAudio } from '../../src/game/GameAudio';
import { LastExitScene } from './LastExitScene';
import { LastExitAudio } from './audio';
import { assetCount, type LastExitAssetState } from './assets';
import { layoutHtml } from './layout';
import { raceAnchor, raceDisplay, raceHundredths, validRaceTime, type RaceAnchor, type RacePhase } from './model';
import { routePosition, zoneOf, zones } from './route';
import { titleAt, type StuntVariant } from './stunts';
import { money, text } from './text';
import './last-exit.css';

type Finish = { id: string; value: number; returned: string; presented: boolean };
const presentedOutcomes = new Set<string>();
/** A late press of the exit must never become the next paid start. */
export const RESTART_LOCK_MS = 900;

export class LastExitUI {
 private priorities: ActionGameLayout;
 private root = document.createElement('section'); private alive = true; private owner = client.accountId; private epoch = 0;
 private stake = '10'; private error = ''; private anchor?: RaceAnchor; private frame = 0;
 private poll: ReturnType<typeof setInterval>; private scene: LastExitScene; private audio = new LastExitAudio(); private history: Finish[] = [];
 private resultId = ''; private follow = false; private actionHeld = false; private media = matchMedia('(prefers-reduced-motion: reduce)'); private reduced = false;
 private resync?: { id: string; after: number; requested: boolean }; private restoreEnding = false;
 private lockUntil = 0; private lockTimer?: ReturnType<typeof setTimeout>; private cardShown = ''; private carAt = 0;
 private nodes = new Map<string, HTMLElement>(); private needles: SVGGElement[]; private stops: HTMLElement[];
 private preferenceOff: () => void;
 private change = () => this.sync();
 private visibility = () => {
  this.audio.silence();
  if (document.hidden) { this.follow = false; resetGameOutcomes(this.root); cancelAnimationFrame(this.frame); this.frame = 0; }
  else { this.queueResync(); this.sync(); void client.refresh(); }
 };
 private motion = () => { this.reduced = this.media.matches; this.root.dataset.reducedMotion = String(this.reduced); };
 constructor(host: HTMLElement) {
  this.reduced = this.media.matches;
  try { this.reduced = localStorage.getItem('royal-last-exit-reduced') === '1' || this.reduced; } catch { /* private window */ }
  this.root.className = 'last-exit'; this.root.dataset.game = 'github-crash'; this.root.setAttribute('aria-label', 'LAST EXIT');
  this.root.innerHTML = layoutHtml(this.reduced, gameAudio.getPreferences().volume, assetCount);
  host.replaceChildren(this.root);
  this.needles = Array.from(this.root.querySelectorAll<SVGGElement>('[data-needle]')); this.stops = Array.from(this.root.querySelectorAll<HTMLElement>('[data-stop]'));
  const gear = document.createElement('button'); gear.type = 'button'; gear.dataset.options = ''; gear.textContent = '⚙'; gear.setAttribute('aria-label', text('Настройки игры', 'Game settings'));
  this.find('.le-console').append(gear);
  this.priorities = new ActionGameLayout(host, this.root, gear, [this.find('.le-tools')], text('Настройки заезда', 'Run settings'), text('Закрыть', 'Close'));
  this.scene = new LastExitScene(this.find<HTMLCanvasElement>('canvas'));
  this.scene.sound = (kind, power, pan) => { if (!this.reduced && !this.restoreEnding) this.audio.effect(kind, power, pan); };
  this.loadHistory(); this.renderHistory();
  this.find('[data-loading-retry]').onclick = () => this.loadAssets();
  const stake = this.find<HTMLSelectElement>('[data-stake]'); stake.value = this.stake;
  stake.onchange = event => { if (!client.busy && !client.pending && !this.active()) { this.stake = (event.target as HTMLSelectElement).value; this.sync(); } };
  this.find('[data-start]').onclick = () => {
   if (performance.now() < this.lockUntil) return;
   void this.audio.unlock(); void this.act({ gameId: 'github-crash', action: 'start', stakeUnits: this.stake, settings: {} });
  };
  this.find('[data-cashout]').onclick = () => { const s = this.session(); if (s?.state === 'active') void this.act({ gameId: 'github-crash', action: 'move', sessionId: s.id, move: 'cashout' }); };
  this.find('[data-retry]').onclick = () => void this.retry();
  this.find('[data-refresh]').onclick = () => { this.error = ''; this.follow = false; resetGameOutcomes(this.root); void client.refresh(); };
  this.find('[data-sound]').onclick = () => { this.audio.setEnabled(!this.audio.isEnabled()); this.soundLabel(); };
  this.find('[data-rules]').onclick = () => this.find<HTMLDialogElement>('.le-dialog').showModal();
  this.find('[data-close]').onclick = () => this.find<HTMLDialogElement>('.le-dialog').close();
  this.find<HTMLInputElement>('[data-reduced]').onchange = event => {
   this.reduced = (event.target as HTMLInputElement).checked;
   try { localStorage.setItem('royal-last-exit-reduced', this.reduced ? '1' : '0'); } catch { /* private window */ }
   this.root.dataset.reducedMotion = String(this.reduced);
  };
  this.find<HTMLInputElement>('[data-volume]').oninput = event => gameAudio.setVolume(Number((event.target as HTMLInputElement).value));
  this.preferenceOff = gameAudio.onPreferences(p => { if (this.alive) this.find<HTMLInputElement>('[data-volume]').value = String(p.volume); });
  client.addEventListener('change', this.change); demoWallet.addEventListener('change', this.change); document.addEventListener('visibilitychange', this.visibility); this.media.addEventListener('change', this.motion);
  this.poll = setInterval(() => { if (this.alive && !document.hidden && !client.busy && !client.pending && !client.loading && this.active()) void client.refresh(); }, 350);
  this.queueResync(); this.soundLabel(); this.sync(); this.loadAssets(); void client.refresh();
 }
 private loadAssets() { void this.scene.load(state => this.assetState(state)); }
 private assetState(state: LastExitAssetState) {
  if (!this.alive) return;
  this.root.dataset.assetState = state.status; this.find('[data-loading]').hidden = state.status === 'ready';
  this.find('[data-loading-title]').textContent = state.status === 'error' ? text('ЗАГРУЗКА ПРЕРВАЛАСЬ', 'LOADING INTERRUPTED') : text('ГОТОВИМ ПОГОНЮ', 'PREPARING THE CHASE');
  this.find('[data-loading-detail]').textContent = state.status === 'error' ? text('Не все ресурсы готовы. Проверь соединение и повтори загрузку.', 'Some resources are not ready. Check your connection and retry.') : text('Загружаем дорогу, машины и все финалы заезда.', 'Loading the road, cars and every ending.');
  const progress = this.find<HTMLProgressElement>('[data-loading-progress]'); progress.max = state.total; progress.value = state.loaded;
  this.find('[data-loading-count]').textContent = state.loaded + ' / ' + state.total; this.find('[data-loading-retry]').hidden = state.status !== 'error'; this.sync();
 }
 private find<T extends HTMLElement = HTMLElement>(selector: string) {
  let node = this.nodes.get(selector);
  if (!node) { node = this.root.querySelector<HTMLElement>(selector)!; this.nodes.set(selector, node); }
  return node as T;
 }
 private put(selector: string, value: string) { const node = this.find(selector); if (node.textContent !== value) node.textContent = value; }
 private session() { return client.sessions.find(s => s.gameId === 'github-crash'); }
 private active() { return this.session()?.state === 'active'; }
 private queueResync() {
  const s = this.session(); this.resync = s?.state === 'active' && validRaceTime(s) ? { id: s.id, after: s.serverNow!, requested: false } : undefined;
  if (s?.state === 'settled' && this.wasPresented(s.id)) this.restoreEnding = true;
 }
 private requestResume() {
  // An older in-flight read must finish before requesting the resume snapshot.
  const s = this.session();
  if (this.resync && !this.resync.requested && s?.id === this.resync.id && !client.loading && !client.busy && !client.pending && client.accountId) { this.resync.after = s.serverNow!; this.resync.requested = true; void client.refresh(); }
 }
 private wasPresented(id: string) { return presentedOutcomes.has(this.owner + ':' + id) || this.history.some(item => item.id === id && item.presented); }
 private saveHistory() { try { localStorage.setItem('royal-last-exit-history:' + this.owner, JSON.stringify(this.history)); } catch { /* private window */ } }
 private loadHistory() {
  this.history = [];
  try {
   const value = JSON.parse(localStorage.getItem('royal-last-exit-history:' + this.owner) ?? '[]');
   if (Array.isArray(value)) this.history = value.filter(v => typeof v?.id === 'string' && Number.isFinite(v.value) && v.value >= 1 && v.value <= 100 && typeof v.returned === 'string' && /^\d{1,15}$/.test(v.returned)).slice(0, 10).map(v => ({ id: v.id, value: v.value, returned: v.returned, presented: v.presented !== false }));
  } catch { /* damaged local history is ignored */ }
 }
 private renderHistory() {
  const el = this.find('[data-history]'); el.replaceChildren();
  for (const item of this.history.slice(0, 7)) {
   const win = item.returned !== '0', span = document.createElement('span'); span.className = win ? 'le-plate' : 'le-plate loss';
   span.textContent = (raceHundredths(item.value, win) / 100).toFixed(2) + '×';
   span.title = win ? text('Выплата: ', 'Payout: ') + money(item.returned) : text('Авария', 'Crash');
   span.setAttribute('aria-label', span.textContent + ' ' + span.title); el.append(span);
  }
 }
 private soundLabel() { const on = this.audio.isEnabled(); this.find('[data-sound]').setAttribute('aria-pressed', String(on)); this.find('[data-sound-value]').textContent = on ? text('вкл.', 'on') : text('выкл.', 'off'); }
 private sync() {
  if (!this.alive) return;
  if (this.owner !== client.accountId) {
   this.epoch++; this.owner = client.accountId; this.anchor = undefined; this.resync = undefined; this.restoreEnding = false; this.error = ''; this.stake = '10'; this.resultId = ''; this.follow = false; this.actionHeld = false; this.lockUntil = 0; this.cardShown = '';
   this.audio.silence(); this.loadHistory(); this.renderHistory(); this.queueResync(); resetGameOutcomes(this.root);
  }
  const s = this.session(), active = s?.state === 'active', balance = demoWallet.wallet?.balance ?? client.wallet?.balance, postBlocked = client.busy || !!client.pending || this.actionHeld || document.hidden, blocked = postBlocked || client.loading || !this.scene.ready, ready = !!client.accountId && balance !== undefined;
  if (active && validRaceTime(s)) {
   const fresh = this.resync?.id === s.id && this.resync.requested && !client.loading && !client.busy && s.serverNow! > this.resync.after;
   this.anchor = raceAnchor(s, this.anchor, performance.now(), fresh);
   if (fresh || this.resync?.id !== s.id) this.resync = undefined;
  } else { this.anchor = undefined; this.resync = undefined; }
  if (s?.state === 'settled' && this.resultId !== s.id) {
   this.resultId = s.id; this.restoreEnding = this.wasPresented(s.id);
   const value = s.returnedUnits === '0' ? s.crashAt ?? 1 : s.multiplier ?? 1;
   this.history = [{ id: s.id, value, returned: s.returnedUnits, presented: this.restoreEnding }, ...this.history.filter(v => v.id !== s.id)].slice(0, 10);
   this.saveHistory(); this.renderHistory();
   if (!this.restoreEnding) { this.lockUntil = performance.now() + RESTART_LOCK_MS; clearTimeout(this.lockTimer); this.lockTimer = setTimeout(() => this.sync(), RESTART_LOCK_MS + 20); }
  }
  const locked = performance.now() < this.lockUntil;
  this.root.dataset.sessionId = s?.id ?? ''; this.root.dataset.state = s?.state ?? 'idle'; this.root.dataset.reducedMotion = String(this.reduced); this.root.setAttribute('aria-busy', String(!this.scene.ready || client.busy || !!client.pending || this.actionHeld));
  this.put('[data-balance]', balance === undefined ? '...' : money(String(Math.round(balance * 100))));
  const stake = this.find<HTMLSelectElement>('[data-stake]'); if (active) this.stake = s.stakeUnits; this.stake = syncStakeSelect(stake, this.stake, ROYAL_GAME_STAKE_UNITS, !!active || blocked);
  const start = this.find<HTMLButtonElement>('[data-start]'); start.hidden = !!active; start.disabled = blocked || locked || !ready || Number(this.stake) > (balance ?? 0) * 100;
  start.querySelector('span')!.textContent = s ? text('ЕЩЁ ОДИН ЗАЕЗД', 'ONE MORE RUN') : text('НАЧАТЬ ЗАЕЗД', 'START YOUR RUN'); this.put('[data-start-price]', text('Ставка ', 'Bet ') + money(this.stake));
  const cash = this.find<HTMLButtonElement>('[data-cashout]'); cash.hidden = !active; cash.disabled = postBlocked || !ready || !s || !validRaceTime(s) || s.serverNow! < s.startedAt!;
  this.find('[data-recovery]').hidden = !canRecoverOperation(client); this.find<HTMLButtonElement>('[data-retry]').disabled = client.busy || client.loading || document.hidden;
  this.find<HTMLButtonElement>('[data-refresh]').disabled = client.busy || client.loading || document.hidden; this.put('.le-error', this.error || client.error);
  observeExpansionOutcome(this.root, 'github-crash', s, client.accountId, blocked || !this.follow || document.hidden, this.follow && client.pending?.gameId === 'github-crash');
  if (!document.hidden) this.requestResume();
  if (!document.hidden && !this.frame) this.frame = requestAnimationFrame(t => this.tick(t));
 }
 private tick(now: number) {
  this.frame = 0; if (!this.alive || document.hidden) return;
  const accepted = this.session(), starting = client.pending?.gameId === 'github-crash' && client.pending.action === 'start' && client.pending.id !== accepted?.id;
  const s = starting ? undefined : accepted, d = raceDisplay(s, this.anchor, now, this.reduced), settled = s?.state === 'settled';
  const returned = settled ? BigInt(s.returnedUnits) : 0n, net = settled ? returned - BigInt(s.spentUnits) : 0n;
  this.root.dataset.motionPhase = d.phase; this.root.dataset.confirmedServerNow = String(s?.serverNow ?? 0); this.root.dataset.displayServerNow = String(d.time);
  this.put('[data-value-main]', d.phase === 'waiting' ? String(d.countdown) : (d.hundredths / 100).toFixed(2));
  const fine = this.find('[data-value-fine]'); fine.hidden = d.phase !== 'racing'; this.put('[data-value-fine]', d.phase === 'racing' ? String(Math.floor(d.value * 1000) % 10) : ''); this.find('[data-value-unit]').hidden = d.phase === 'waiting';
  this.root.dataset.connectionState = d.stalled || client.error ? 'delayed' : this.resync ? 'syncing' : 'current';
  this.put('[data-caption]', ({ idle: text('ТВОЙ ЗАЕЗД', 'YOUR RUN'), waiting: text('ДО СТАРТА', 'STARTS IN'), racing: text('МНОЖИТЕЛЬ ЗАЕЗДА', 'RUN MULTIPLIER'), escaped: text('ТЫ УШЁЛ ОТ ПОГОНИ', 'YOU TOOK THE EXIT'), crashed: text('ПЕРЕХВАТ', 'INTERCEPTED') })[d.phase]);
  // The confirmed amount takes the sign at once. Scenes never delay it.
  const status = client.pending && !client.busy ? text('Проверяем ту же операцию…', 'Checking the same operation…') : d.stalled || client.error ? text('Связь задерживается. Проверь результат.', 'Connection delayed. Check your result.') : this.resync ? text('Восстанавливаем заезд…', 'Restoring your run…') : '';
  const showResult = settled && !status; this.find('[data-result]').hidden = !showResult; this.find('[data-status]').hidden = showResult;
  if (settled) this.put('[data-result]', returned === 0n ? text('Ставка ', 'Bet ') + money(s.spentUnits) + text(' проиграна', ' lost') : net > 0n ? text('Выплата +', 'Payout +') + money(returned) : text('Возврат ', 'Returned ') + money(returned));
  this.put('[data-status]', status || (starting ? text('Заводим двигатель…', 'Starting the engine…') : d.phase === 'racing' ? text('Успей уйти до аварии', 'Take the exit before the crash') : d.phase === 'waiting' ? text('Пристегнись', 'Buckle up') : text('У каждого заезда есть последний съезд', 'Every run has one last exit')));
  const estimated = BigInt(this.stake) * BigInt(d.hundredths) / 100n; this.put('[data-cash-value]', '≈ ' + money(estimated));
  const restored = !!settled && this.restoreEnding, stage = this.find('.le-stage');
  this.scene.revving = starting && !this.reduced; this.scene.top = this.find('.le-mult').offsetTop + this.find('.le-mult').offsetHeight;
  this.scene.paint(now, d.phase, d.value, this.reduced, s?.id ?? '', restored);
  if (this.scene.ready && settled) { const item = this.history.find(entry => entry.id === s.id); if (item && !item.presented) { item.presented = true; presentedOutcomes.add(this.owner + ':' + s.id); if (presentedOutcomes.size > 128) presentedOutcomes.delete(presentedOutcomes.values().next().value!); this.saveHistory(); } }
  this.instruments(d.phase, d.value); this.message(d.phase, settled ? s.returnedUnits : '0', net, d.hundredths); this.title(d.phase, s?.id ?? '', returned, net, s?.spentUnits ?? '0', d.hundredths, restored);
  const jolt = this.reduced ? 0 : this.scene.jolt; stage.style.setProperty('--le-jolt', jolt < .02 ? '0' : jolt.toFixed(3)); stage.style.setProperty('--le-sway', jolt < .02 ? '0' : (Math.sin(now * .05) * jolt).toFixed(3));
  this.put('[data-speed]', d.phase === 'racing' ? Math.max(0, this.scene.speed).toFixed(1) : '0');
  if (this.scene.ready) this.audio.update(d.phase, d.value, d.seconds, this.reduced, s?.id ?? '', this.scene.presentationSeconds(), restored);
  if (Math.floor(now / 250) !== Number(this.root.dataset.audioSample)) { this.root.dataset.audioSample = String(Math.floor(now / 250)); this.root.dataset.audio = JSON.stringify(this.audio.state()); }
  this.frame = requestAnimationFrame(t => this.tick(t));
 }
 private instruments(phase: RacePhase, value: number) {
  const quiet = phase === 'idle' || phase === 'waiting', zone = quiet ? 0 : zoneOf(value), next = zone + 1, target = routePosition(quiet ? 1 : value);
  this.carAt = Math.abs(target - this.carAt) > 40 || this.reduced ? target : this.carAt + (target - this.carAt) * .12;
  this.find('[data-route-car]').style.left = this.carAt + '%'; this.find('[data-fill]').style.width = this.carAt + '%';
  this.stops.forEach((stop, i) => stop.classList.toggle('on', i === 0 || !quiet && i <= zone || value >= 100 && !quiet));
  this.put('[data-next-label]', next > 3 ? text('ДО ФИНИША', 'TO THE FINISH') : text('ДАЛЬШЕ', 'AHEAD'));
  this.put('[data-next-name]', next > 3 ? text('Финиш', 'Finish') : text(zones[next].ru, zones[next].en)); this.put('[data-next-value]', next > 3 ? '100×' : zones[next].min + '×');
  this.find('[data-cashout]').dataset.tab = text('СЪЕЗД ', 'EXIT ') + (zone + 1);
  this.needles[0].style.transform = `rotate(${-220 + 260 * Math.min(1, this.reduced ? 0 : this.scene.rpm)}deg)`; this.needles[1].style.transform = `rotate(${-220 + 260 * Math.min(1, this.scene.speed / 280)}deg)`;
 }
 private exitName(variant: StuntVariant) { return variant === 'helicopter' ? text('вертолёт', 'helicopter') : variant === 'cargo-plane' ? text('самолёт', 'aircraft') : text('тоннель', 'tunnel'); }
 private message(phase: RacePhase, returned: string, net: bigint, hundredths: number) {
  const at = (hundredths / 100).toFixed(2) + '×', zone = zones[this.scene.locationIndex()];
  this.put('[data-message]', phase === 'racing' ? text(zone.ru, zone.en) + '. ' + text('Чем дальше, тем выше риск.', 'Go further, risk more.')
   : phase === 'waiting' ? text('Ставка принята: ', 'Bet accepted: ') + money(this.stake) + '.'
   : phase === 'crashed' ? text('Авария на ', 'Crashed at ') + at + '. ' + text('Выплата 0,00.', 'Payout 0.00.')
   : phase === 'escaped' ? net > 0n ? text('Съезд на ', 'Exit at ') + at + ', ' + this.exitName(this.scene.ending()) + '. ' + text('Зачислено ', 'Credited ') + money(returned) + '.' : text('Съезд на ', 'Exit at ') + at + '. ' + text('Ставка вернулась: ', 'Bet returned: ') + money(returned) + '.'
   : text('Выбери ставку. Множитель растёт до 100×.', 'Choose a bet. The multiplier climbs to 100×.'));
 }
 /** Closing title. Its scale follows the credited amount, not the multiplier. */
 private title(phase: RacePhase, id: string, returned: bigint, net: bigint, spent: string, hundredths: number, restored: boolean) {
  const card = this.find('[data-card]'), ended = phase === 'escaped' || phase === 'crashed';
  if (!ended) { if (!card.hidden) card.hidden = true; this.cardShown = ''; return; }
  if (this.cardShown === id || !this.scene.ready || !restored && !this.reduced && this.scene.presentationSeconds() < titleAt[this.scene.ending()]) { if (this.cardShown !== id && !card.hidden) card.hidden = true; return; }
  this.cardShown = id; const at = (hundredths / 100).toFixed(2) + '×', loss = phase === 'crashed';
  card.dataset.tone = loss ? 'loss' : net <= 0n ? 'flat' : net >= 7n * BigInt(spent) ? 'big' : 'win'; card.dataset.still = String(restored || this.reduced);
  this.put('[data-card-caption]', loss ? text('ПОГОНЯ ОКОНЧЕНА', 'END OF THE CHASE') : text('СЪЕЗД ', 'EXIT ') + at + ' · ' + this.exitName(this.scene.ending()).toUpperCase());
  this.put('[data-card-title]', loss ? text('ПЕРЕХВАТ', 'INTERCEPTED') : net > 0n ? text('ТЫ УШЁЛ', 'YOU GOT AWAY') : text('СТАВКА ВЕРНУЛАСЬ', 'BET RETURNED'));
  this.put('[data-card-amount]', loss ? text('Авария на ', 'Crashed at ') + at + '. ' + text('Ставка ', 'Bet ') + money(spent) + text(' проиграна', ' lost') : (net > 0n ? '+' : '') + money(returned) + ' USDT');
  card.hidden = false;
 }
 private async act(op: NewExpansionAction) {
  // A state read must not delay an exit. send() invalidates its stale response.
  if (!this.alive || document.hidden || client.busy || client.pending || this.actionHeld || (client.loading || !this.scene.ready) && op.action === 'start') return;
  const account = client.accountId, epoch = this.epoch; this.error = ''; this.follow = true; this.actionHeld = true;
  try { await client.act(op); } catch (e) { if (this.alive && account === client.accountId && epoch === this.epoch) { this.error = (e as Error).message; this.follow = false; resetGameOutcomes(this.root); } }
  finally { if (this.alive && account === client.accountId && epoch === this.epoch) { this.actionHeld = false; this.sync(); } }
 }
 private async retry() {
  if (document.hidden || client.busy) return; this.error = ''; this.follow = false; resetGameOutcomes(this.root); const account = client.accountId, epoch = this.epoch;
  try { await client.retry(); } catch (e) { if (this.alive && account === client.accountId && epoch === this.epoch) this.error = (e as Error).message; }
  if (this.alive && account === client.accountId && epoch === this.epoch) this.sync();
 }
 destroy() {
  this.alive = false; this.epoch++; this.follow = false; resetGameOutcomes(this.root); cancelAnimationFrame(this.frame); clearInterval(this.poll); clearTimeout(this.lockTimer);
  this.audio.destroy(); this.scene.destroy(); this.preferenceOff(); client.removeEventListener('change', this.change); demoWallet.removeEventListener('change', this.change); document.removeEventListener('visibilitychange', this.visibility); this.media.removeEventListener('change', this.motion);
  this.find<HTMLDialogElement>('.le-dialog').close(); this.priorities.destroy(); this.root.remove();
 }
}
