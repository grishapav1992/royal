import { isUserMessage, t as translateText } from '../i18n/index';
import { validProgressionSnapshot, validRewardSpinRequest, validRewardSpinResult,
  type ProgressionSnapshot, type RewardSpinRequest, type RewardSpinResult } from '../shared/progression';
import { WALLET_ACCOUNT_HEADER } from '../shared/walletAccount';
import { demoWallet } from './WalletClient';

const owner = 'progression';
const uncertain = () => translateText('Ответ бесплатного спина не подтверждён. Повтори проверку той же операции.');
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class ProgressionClient extends EventTarget {
  accountId: string | null = null;
  snapshot?: ProgressionSnapshot;
  pending?: RewardSpinRequest;
  last?: RewardSpinResult;
  busy = false;
  loading = false;
  recoveryBlocked = false;
  error = '';
  private epoch = 0;
  private readVersion = 0;
  private request?: AbortController;
  private refreshAgain = false;
  constructor(private recoveryStorage?: RecoveryStorage) { super(); }
  private get storage() { return this.recoveryStorage ?? globalThis.sessionStorage; }
  private key(account = this.accountId) { return `royal-reward-spin:${account}`; }
  private notify() { this.dispatchEvent(new Event('change')); }
  private lock() { demoWallet.setExternalBusy(owner, this.busy || !!this.pending || this.recoveryBlocked); }
  get walletBlocked() { return demoWallet.busy || !!demoWallet.pending || demoWallet.hasExternalBusy(owner); }

  setAccount(account: string | null) {
    if (account === this.accountId) return;
    this.epoch++; this.readVersion++; this.request?.abort(); this.request = undefined;
    this.accountId = account; this.snapshot = undefined; this.pending = undefined; this.last = undefined;
    this.busy = this.loading = this.refreshAgain = this.recoveryBlocked = false; this.error = '';
    if (account) {
      try {
        const saved = this.storage.getItem(this.key());
        if (saved) {
          const operation: unknown = JSON.parse(saved);
          if (!validRewardSpinRequest(operation)) throw Error('invalid_saved_reward_spin');
          this.pending = operation;
        }
      } catch {
        this.recoveryBlocked = true;
        this.error = translateText('Не удалось восстановить бесплатный спин. Проверь данные перед игрой.');
      }
    }
    this.lock(); this.notify();
    if (account) void this.refresh();
  }

  async refresh() {
    if (!this.accountId) return;
    if (this.loading || this.busy) { this.refreshAgain = true; return; }
    const account = this.accountId, epoch = this.epoch, version = ++this.readVersion;
    const request = new AbortController(); this.request = request; this.loading = true; this.notify();
    const timer = setTimeout(() => request.abort(), 10000);
    try {
      const response = await fetch('/api/progression', { credentials: 'same-origin', cache: 'no-store',
        headers: { [WALLET_ACCOUNT_HEADER]: account }, signal: request.signal });
      const data: unknown = await response.json();
      if (epoch !== this.epoch || version !== this.readVersion) return;
      if (!response.ok || !validProgressionSnapshot(data) || data.accountId !== account) throw Error('invalid_progression_snapshot');
      this.snapshot = data;
      if (!this.pending && !this.recoveryBlocked) this.error = '';
    } catch {
      if (epoch === this.epoch && version === this.readVersion && !this.pending && !this.recoveryBlocked) {
        this.error = translateText('Не удалось подтвердить уровни. Обнови данные.');
      }
    } finally {
      clearTimeout(timer);
      if (epoch === this.epoch && version === this.readVersion) {
        this.request = undefined; this.loading = false; this.notify();
        if (this.refreshAgain) { this.refreshAgain = false; void this.refresh(); }
      }
    }
  }

  async spin(grantId: string) {
    if (this.pending) throw Error(translateText('Сначала проверь предыдущий бесплатный спин.'));
    return this.send({ id: crypto.randomUUID(), grantId });
  }
  async retry() {
    if (!this.pending) return;
    return this.send(this.pending);
  }
  private message(error: unknown) {
    return error instanceof Error && isUserMessage(error.message) ? translateText(error.message) : uncertain();
  }
  private async send(operation: RewardSpinRequest): Promise<RewardSpinResult> {
    if (!this.accountId) throw Error(translateText('Войди в аккаунт, чтобы открыть уровни.'));
    if (this.busy) throw Error(translateText('Дождись завершения бесплатного спина.'));
    if (this.recoveryBlocked) throw Error(this.error);
    if (this.walletBlocked) throw Error(translateText('Сначала проверь незавершённую операцию в другой игре.'));
    if (!validRewardSpinRequest(operation)) throw Error(translateText('Некорректный запрос бесплатного спина.'));
    if (this.pending && (operation.id !== this.pending.id || operation.grantId !== this.pending.grantId)) {
      throw Error(translateText('Сначала проверь предыдущий бесплатный спин.'));
    }
    const account = this.accountId, epoch = this.epoch, key = this.key(), storage = this.storage;
    try { storage.setItem(key, JSON.stringify(operation)); }
    catch { throw Error(translateText('Разреши хранилище браузера для сохранения бесплатного спина.')); }
    this.request?.abort(); this.request = undefined; this.loading = false; this.readVersion++;
    this.pending = operation; this.busy = true; this.error = ''; this.lock(); this.notify();
    try {
      const response = await fetch('/api/progression/spins', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', [WALLET_ACCOUNT_HEADER]: account },
        body: JSON.stringify(operation), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (epoch !== this.epoch) throw Error(translateText('Аккаунт изменился. Проверь бесплатный спин после входа в прежний аккаунт.'));
      if (!response.ok) {
        if ([400, 403, 404, 409].includes(response.status) && result?.rejected === true) {
          storage.removeItem(key); this.pending = undefined;
        }
        throw Error(result?.error ?? uncertain());
      }
      const grant = this.snapshot?.grants.find(value => value.id === operation.grantId);
      if (!validRewardSpinResult(result) || result.id !== operation.id || result.grantId !== operation.grantId
        || !('balance' in result.wallet) || result.wallet.asset === 'USDT_NILE_TEST'
        || grant && (result.gameRound.gameId !== grant.gameId
          || BigInt(result.gameRound.stakeUnits) * 10000n !== BigInt(grant.stakeUnits))) throw Error(uncertain());
      demoWallet.acceptExternalWallet(account, result.wallet);
      this.last = result;
      if (this.snapshot) this.snapshot = { ...this.snapshot, grants: this.snapshot.grants.map(value => value.id === operation.grantId
        ? { ...value, remaining: Math.min(value.remaining, result.remaining) } : value) };
      storage.removeItem(key); this.pending = undefined; this.error = ''; this.readVersion++;
      return result;
    } catch (error) {
      const message = this.message(error);
      if (epoch === this.epoch) this.error = message;
      throw Error(message);
    } finally {
      if (epoch === this.epoch) {
        this.busy = false; this.lock(); this.notify(); this.refreshAgain = false;
        if (!this.pending) void this.refresh();
      }
    }
  }
}

export const progression = new ProgressionClient();
demoWallet.addEventListener('change', () => progression.setAccount(demoWallet.accountId));
demoWallet.addEventListener('settlement', () => { void progression.refresh(); });
