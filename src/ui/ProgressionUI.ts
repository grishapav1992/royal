import { locale, t, tr } from '../i18n/index';
import type { RoomScene } from '../game/RoomScene';
import type { FreeSpinReward, ProgressionGrant, RewardGame } from '../shared/progression';
import { formatNileUnits } from '../shared/nileWallet';
import { DEMO_SYMBOLS } from '../shared/demoWallet';
import { progression, type ProgressionClient } from '../wallet/ProgressionClient';
import { demoWallet } from '../wallet/WalletClient';
import { fruitSymbol, FRUITS_SYMBOL_NAMES } from './FruitsArtwork';
import { registerGameChatDialog } from './GameChat';
import './progression.css';

const xp = (value: string | bigint) => BigInt(value).toLocaleString(locale);
const gameName = (game: RewardGame) => game === 'royal-coins' ? 'Royal Coins' : 'Royal Fruits';
const rewardText = (reward: FreeSpinReward | ProgressionGrant) => `${gameName(reward.gameId)} · ${tr`${reward.count} спинов по ${formatNileUnits(reward.stakeUnits)} USDT`}`;

export class ProgressionUI {
  readonly dialog = document.createElement('dialog');
  private button = document.createElement('button');
  private selectedLevel = 1;
  private tab: 'track' | 'rewards' = 'track';
  private renderedResult = '';
  private feedback = '';
  private account: string | null = null;
  constructor(private scene: RoomScene, private client: ProgressionClient = progression) {
    this.button.type = 'button'; this.button.id = 'progression-button'; this.button.className = 'progression-button';
    this.button.hidden = true; this.button.onclick = () => this.show();
    document.querySelector('.profile-name')?.after(this.button);
    this.dialog.id = 'progression-dialog'; this.dialog.setAttribute('aria-labelledby', 'progression-title');
    this.dialog.innerHTML = tr`<header class="progression-heading"><div><span class="eyebrow">Твой прогресс</span><h2 id="progression-title">Уровни локации</h2></div><button type="button" class="icon-button" data-progression-close aria-label="Закрыть уровни">×</button></header>
      <div class="progression-scroll"><p class="progression-status" data-progression-loading role="status"></p>
      <section data-progression-summary class="progression-summary" hidden><div class="progression-level" data-progression-current-level></div><div><h3 data-progression-location></h3><p data-progression-xp></p><progress data-progression-progress max="100" value="0"></progress><p data-progression-next-level></p></div></section>
      <section class="progression-next" data-progression-next hidden></section>
      <p class="progression-notes">Опыт начисляется после расчёта платных игр и ставок PvP. Бесплатные спины не дают XP.</p>
      <div class="progression-tools"><button type="button" data-progression-tab="track" aria-pressed="true">Дорожка наград</button><button type="button" data-progression-tab="rewards" aria-pressed="false">Мои бесплатные спины</button><button type="button" data-progression-refresh>Обновить уровни</button></div>
      <p class="progression-error" data-progression-error role="alert" hidden></p><p class="progression-status" data-progression-pending role="status" hidden></p><button type="button" class="primary-button" data-progression-retry hidden>Проверить бесплатный спин</button>
      <section data-progression-track><div class="progression-detail" data-progression-detail></div><ol class="progression-roadmap" data-progression-roadmap aria-label="Дорожка наград"></ol><p class="progression-notes">Бесплатные спины начисляются автоматически за достигнутые уровни.</p></section>
      <section data-progression-rewards hidden><section class="progression-result" data-progression-result role="status" hidden></section><div class="progression-grants" data-progression-grants></div></section>
      <p class="progression-notes">Прогресс этой локации сохраняется. В новой локации уровни начинаются с 1.</p></div>`;
    document.body.append(this.dialog);
    registerGameChatDialog(this.dialog);
    this.find('[data-progression-close]').onclick = () => this.dialog.close();
    this.find('[data-progression-refresh]').onclick = () => { void this.client.refresh(); };
    this.find('[data-progression-retry]').onclick = () => { void this.run(() => this.client.retry()); };
    this.dialog.addEventListener('close', () => scene.setLocked(!!document.querySelector('dialog[open]')));
    this.dialog.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.dataset.progressionTab) {
        this.tab = button.dataset.progressionTab as 'track' | 'rewards'; this.render();
      } else if (button.dataset.progressionLevel) {
        this.selectedLevel = Number(button.dataset.progressionLevel); this.renderDetail();
      } else if (button.dataset.progressionGrant) {
        this.tab = 'rewards'; void this.run(() => this.client.spin(button.dataset.progressionGrant!));
      }
    });
    window.addEventListener('royal-account', event => this.client.setAccount((event as CustomEvent<string | null>).detail));
    client.addEventListener('change', () => this.render());
    demoWallet.addEventListener('change', () => this.render());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void client.refresh(); });
    setInterval(() => { if (client.accountId && !document.hidden) void client.refresh(); }, 15000);
    client.setAccount(demoWallet.accountId); this.render();
  }
  private find<T extends HTMLElement = HTMLElement>(selector: string) { return this.dialog.querySelector<T>(selector)!; }
  private show() {
    if (!this.client.accountId || document.querySelector('dialog[open]')) return;
    this.scene.setLocked(true); this.dialog.showModal(); this.render(); void this.client.refresh();
  }
  private async run(action: () => Promise<unknown>) {
    const account = this.client.accountId;
    this.feedback = '';
    try { await action(); }
    catch (error) {
      if (account === this.client.accountId) {
        const alert = this.find('[data-progression-error]');
        this.feedback = error instanceof Error ? error.message : t('Ответ бесплатного спина не подтверждён. Повтори проверку той же операции.');
        alert.textContent = this.feedback;
        alert.hidden = false;
      }
    }
    if (account === this.client.accountId) this.render();
  }
  private render() {
    const client = this.client, snapshot = client.snapshot;
    if (this.account !== client.accountId) {
      this.account = client.accountId; this.tab = 'track'; this.selectedLevel = 1; this.renderedResult = ''; this.feedback = '';
      this.find('[data-progression-roadmap]').dataset.policy = '';
      this.find('[data-progression-result]').hidden = true;
      if (!client.accountId) this.dialog.close();
    }
    this.button.hidden = !client.accountId;
    this.button.textContent = tr`Уровень ${snapshot?.level ?? '…'}`;
    this.button.setAttribute('aria-label', t('Уровни локации'));
    this.find('[data-progression-loading]').textContent = !client.accountId ? t('Войди в аккаунт, чтобы открыть уровни.')
      : !snapshot && client.loading ? t('Загружаем уровни…') : '';
    this.find('[data-progression-summary]').hidden = !snapshot;
    this.find<HTMLButtonElement>('[data-progression-refresh]').disabled = client.loading || client.busy || !client.accountId;
    this.find('[data-progression-track]').hidden = this.tab !== 'track' || !snapshot;
    this.find('[data-progression-rewards]').hidden = this.tab !== 'rewards';
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-progression-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.progressionTab === this.tab)));
    const alert = this.find('[data-progression-error]');
    alert.textContent = client.error || this.feedback || (client.walletBlocked ? t('Сначала проверь незавершённую операцию в другой игре.')
      : snapshot && !snapshot.enabled ? t('Бесплатные спины временно приостановлены. Пакет сохранён.') : '');
    alert.hidden = !alert.textContent;
    const pending = this.find('[data-progression-pending]'); pending.hidden = !client.pending;
    pending.textContent = client.busy ? t('Проверяем результат…') : t('Ответ бесплатного спина не подтверждён. Повтори проверку той же операции.');
    const retry = this.find<HTMLButtonElement>('[data-progression-retry]');
    retry.hidden = !client.pending; retry.disabled = client.busy || client.walletBlocked || client.recoveryBlocked;
    this.dialog.setAttribute('aria-busy', String(client.busy));
    if (!snapshot) return;
    this.find('[data-progression-current-level]').textContent = String(snapshot.level);
    this.find('[data-progression-location]').textContent = snapshot.locationId === 'south-park' ? t('Южный парк') : snapshot.locationId;
    this.find('[data-progression-xp]').textContent = `${xp(snapshot.xp)} XP`;
    const current = snapshot.levels[snapshot.level - 1], next = snapshot.levels[snapshot.level];
    const total = BigInt(snapshot.xp), base = BigInt(current.xp);
    const percent = next ? Number((total - base) * 10000n / (BigInt(next.xp) - base)) / 100 : 100;
    const progress = this.find<HTMLProgressElement>('[data-progression-progress]');
    progress.value = Math.max(0, Math.min(100, percent)); progress.setAttribute('aria-label', tr`Уровень ${snapshot.level}`);
    this.find('[data-progression-next-level]').textContent = next ? tr`До следующего уровня: ${xp(BigInt(next.xp) > total ? BigInt(next.xp) - total : 0n)} XP` : t('Максимальный уровень');
    const nextReward = snapshot.levels.find(level => level.level > snapshot.level && level.reward);
    const nextHost = this.find('[data-progression-next]'); nextHost.hidden = !nextReward;
    nextHost.replaceChildren();
    if (nextReward?.reward) {
      const title = document.createElement('strong'); title.textContent = `${t('Ближайшая награда')} · ${tr`Уровень ${nextReward.level}`}`;
      const text = document.createElement('span'); text.textContent = rewardText(nextReward.reward);
      const distance = document.createElement('span'); distance.textContent = tr`До награды: ${xp(BigInt(nextReward.xp) > total ? BigInt(nextReward.xp) - total : 0n)} XP`;
      nextHost.append(title, text, distance);
    }
    this.renderTrack(); this.renderGrants(); this.renderLast();
  }
  private renderTrack() {
    const snapshot = this.client.snapshot!;
    const roadmap = this.find('[data-progression-roadmap]');
    if (roadmap.dataset.policy !== snapshot.policyVersion) {
      roadmap.replaceChildren(); roadmap.dataset.policy = snapshot.policyVersion;
      for (const level of snapshot.levels) {
        const item = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.dataset.progressionLevel = String(level.level); button.dataset.reward = String(!!level.reward);
        button.append(String(level.level));
        const caption = document.createElement('small'); caption.textContent = level.reward ? `${level.reward.count} FS` : `${xp(level.xp)} XP`;
        button.append(caption); item.append(button); roadmap.append(item);
      }
      this.selectedLevel = snapshot.level;
    }
    for (const button of Array.from(roadmap.querySelectorAll<HTMLButtonElement>('button'))) {
      const level = Number(button.dataset.progressionLevel);
      button.dataset.state = level === snapshot.level ? 'current' : level < snapshot.level ? 'reached' : 'ahead';
      button.setAttribute('aria-current', level === snapshot.level ? 'step' : 'false');
      button.setAttribute('aria-label', `${tr`Уровень ${level}`} · ${t(level === snapshot.level ? 'Текущий' : level < snapshot.level ? 'Достигнут' : 'Впереди')}`);
    }
    this.renderDetail();
  }
  private renderDetail() {
    const snapshot = this.client.snapshot, selected = snapshot?.levels[this.selectedLevel - 1];
    if (!selected || !snapshot) return;
    const host = this.find('[data-progression-detail]'); host.replaceChildren();
    const title = document.createElement('strong'); title.textContent = `${tr`Уровень ${selected.level}`} · ${xp(selected.xp)} XP`;
    const text = document.createElement('span'); text.textContent = selected.reward ? rewardText(selected.reward)
      : t(selected.level <= snapshot.level ? 'Достигнут' : 'Впереди');
    host.append(title, text);
  }
  private renderGrants() {
    const snapshot = this.client.snapshot!, host = this.find('[data-progression-grants]');
    const disabled = this.client.busy || !!this.client.pending || this.client.recoveryBlocked || this.client.walletBlocked || !snapshot.enabled;
    host.replaceChildren();
    if (!snapshot.grants.length) {
      const empty = document.createElement('p'); empty.className = 'progression-empty';
      empty.textContent = t('Пакеты появятся здесь после достижения уровня с наградой.'); host.append(empty); return;
    }
    for (const grant of [...snapshot.grants].sort((a, b) => Number(b.remaining > 0) - Number(a.remaining > 0) || a.level - b.level)) {
      const card = document.createElement('article'); card.className = 'progression-grant'; card.dataset.empty = String(grant.remaining === 0);
      const title = document.createElement('h3'); title.textContent = gameName(grant.gameId);
      const origin = document.createElement('p'); origin.textContent = tr`Награда за уровень ${grant.level}`;
      const nominal = document.createElement('p'); nominal.textContent = tr`${grant.count} спинов по ${formatNileUnits(grant.stakeUnits)} USDT`;
      const remaining = document.createElement('p'); remaining.textContent = tr`Осталось: ${grant.remaining} из ${grant.count}`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button';
      button.dataset.progressionGrant = grant.id; button.textContent = t(grant.remaining ? 'Использовать спин' : 'Пакет использован');
      button.disabled = disabled || grant.remaining === 0;
      card.append(title, origin, nominal, remaining, button); host.append(card);
    }
  }
  private renderLast() {
    const result = this.client.last;
    if (!result || this.renderedResult === result.id) return;
    const host = this.find('[data-progression-result]'); host.replaceChildren(); host.hidden = false; this.renderedResult = result.id;
    const title = document.createElement('h3'); title.textContent = `${t('Последний бесплатный спин')} · ${gameName(result.gameRound.gameId as RewardGame)}`;
    const symbols = document.createElement('div'); symbols.className = 'progression-symbols';
    if ('symbols' in result.gameRound.outcome) for (const symbol of result.gameRound.outcome.symbols) {
      const cell = document.createElement('span');
      if (result.gameRound.gameId === 'royal-fruits') {
        cell.innerHTML = fruitSymbol('royal-fruits', symbol); cell.setAttribute('aria-label', FRUITS_SYMBOL_NAMES[symbol]);
      } else cell.textContent = DEMO_SYMBOLS[symbol] ?? String(symbol);
      symbols.append(cell);
    }
    const payout = document.createElement('p'); payout.className = 'progression-payout'; payout.textContent = `${formatNileUnits(result.payoutUnits)} USDT`;
    const note = document.createElement('p'); note.textContent = t(BigInt(result.payoutUnits) > 0n ? 'Выплата начислена в общий кошелёк.' : 'Без выигрыша. Спин завершён.');
    const free = document.createElement('p'); free.textContent = t('Бесплатно · XP не начисляется');
    const receipt = document.createElement('p'); receipt.textContent = t('Результат подтверждён сервером');
    host.append(title, symbols, payout, note, free, receipt);
  }
}
