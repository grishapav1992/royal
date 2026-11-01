import { t, tr } from '../i18n/index';
import { formatNileUnits } from '../shared/nileWallet';
import { rewardGames, type RewardGame } from '../shared/progression';
import { progression } from '../wallet/ProgressionClient';
import { demoWallet } from '../wallet/WalletClient';
import './reward-spin-controls.css';

/** Presentation only. The host client and the server own pending operations and rights. */
export class RewardSpinControls {
  readonly root = document.createElement('section');
  private select = document.createElement('select');
  private note = document.createElement('p');
  private alive = true;
  private change = () => { this.render(); this.onChange(); };
  constructor(private game: () => string, private onChange: () => void) {
    this.root.className = 'reward-spin-controls'; this.root.dataset.rewardFunding = '';
    const label = document.createElement('label'); label.append(t('Режим игры'), this.select);
    this.select.dataset.rewardMode = ''; this.note.dataset.rewardRemaining = ''; this.note.setAttribute('role', 'status');
    this.root.append(label, this.note);
    this.select.onchange = () => progression.chooseFunding(this.select.value || null);
    progression.addEventListener('change', this.change);
    this.render(); queueMicrotask(() => { if (this.alive) void progression.refresh(); });
  }
  get pending() {
    const pending = progression.pending;
    const grant = progression.snapshot?.grants.find(g => g.id === pending?.grantId);
    return pending && (pending.gameId ?? grant?.gameId) === this.game() ? pending : undefined;
  }
  get active() { return progression.freeNominal !== null || !!this.pending; }
  private get grants() {
    return (progression.snapshot?.grants ?? []).filter(g => rewardGames(g).includes(this.game() as RewardGame));
  }
  get remaining() { return this.grants.filter(g => g.stakeUnits === progression.freeNominal).reduce((n,g) => n + g.remaining, 0); }
  get blocked() { return progression.busy || progression.recoveryBlocked || progression.walletBlocked
    || !!progression.pending && !this.pending || !progression.snapshot?.enabled || !progression.accountId
    || !this.pending && this.remaining === 0; }
  render(disabled = false) {
    const groups = new Map<string, number>();
    for (const grant of this.grants) if (grant.remaining > 0) groups.set(grant.stakeUnits, (groups.get(grant.stakeUnits) ?? 0) + grant.remaining);
    if (progression.freeNominal && !groups.has(progression.freeNominal)) groups.set(progression.freeNominal, 0);
    const selected = progression.freeNominal ?? '';
    const options = [{ value: '', text: t('Платная игра') }, ...[...groups].sort((a,b) => Number(a[0]) - Number(b[0]))
      .map(([value,count]) => ({ value, text: tr`Бесплатно · ${formatNileUnits(value)} USDT · ${count} спинов` }))];
    const signature = JSON.stringify(options);
    if (this.select.dataset.options !== signature) {
      this.select.replaceChildren(...options.map(o => new Option(o.text, o.value)));
      this.select.dataset.options = signature;
    }
    this.select.value = selected;
    this.select.disabled = disabled || progression.busy || !!progression.pending || progression.recoveryBlocked;
    this.root.dataset.mode = this.active ? 'free' : 'paid';
    this.note.textContent = progression.pending ? t('Ответ ещё не подтверждён. Проверь ту же операцию без новой ставки.')
      : this.active ? this.remaining ? tr`Общий остаток: ${this.remaining}. Бесплатно · XP не начисляется.`
      : t('Бесплатные спины закончились. Выбери другой номинал или платную игру.')
      : t('Ставка списывается с общего баланса.');
  }
  async spin() {
    if (this.blocked) throw Error(progression.error || t('Бесплатный спин сейчас недоступен. Обнови данные.'));
    if (this.pending) return progression.retry();
    const grant = this.grants.find(g => g.stakeUnits === progression.freeNominal && g.remaining > 0);
    if (!grant) throw Error(t('Бесплатные спины закончились. Выбери другой номинал или платную игру.'));
    return progression.spin(grant.id, this.game() as RewardGame);
  }
  async refresh() { await Promise.all([progression.refresh(), demoWallet.refresh()]); }
  destroy() { this.alive = false; progression.removeEventListener('change', this.change); this.root.remove(); }
}
