import { t as translateText } from '../i18n/index';
import {WALLET_ACCOUNT_HEADER} from '../shared/walletAccount';
import {AFTER_PROGRESS_HEADER, AFTER_PROGRESS_VERSION, validAfterWardrobe, type AfterWardrobe} from '../shared/afterglowWardrobe';

export class AfterglowWardrobeClient extends EventTarget {
  account: string | null = null; profile?: AfterWardrobe; loading = false; busy = false; error = '';
  private epoch = 0; private version = 0;
  private notify() { this.dispatchEvent(new Event('change')); }
  setAccount(account: string | null) {
    if (account === this.account) return;
    this.epoch++; this.version++; this.account = account; this.profile = undefined;
    this.loading = this.busy = false; this.error = ''; this.notify();
    if (account) void this.refresh();
  }
  async refresh() {
    if (!this.account || this.loading || this.busy) return;
    const account = this.account, epoch = this.epoch, version = ++this.version;
    this.loading = true; this.notify();
    try {
      const r = await fetch('/api/demo-wallet/afterglow-wardrobe', {credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000), headers: {[WALLET_ACCOUNT_HEADER]: account, [AFTER_PROGRESS_HEADER]: AFTER_PROGRESS_VERSION}});
      const data = await r.json(); if (epoch !== this.epoch || version !== this.version) return;
      if (!r.ok || !validAfterWardrobe(data)) throw Error(r.ok ? translateText('Альбом не подтверждён. Обнови данные игры.') : data.error);
      this.profile = data; this.error = '';
    } catch (e) { if (epoch === this.epoch) this.error = e instanceof Error ? translateText(e.message) : translateText('Не удалось загрузить альбом.'); }
    finally { if (epoch === this.epoch) { this.loading = false; this.notify(); } }
  }
  async choose(girl: number, look: 0 | 1) {
    if (!this.account || !this.profile || this.busy || this.loading) throw Error(translateText('Подожди загрузки альбома.'));
    const account = this.account, epoch = this.epoch; ++this.version;
    this.busy = true; this.error = ''; this.notify();
    try {
      const r = await fetch('/api/demo-wallet/afterglow-wardrobe', {method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000), headers: {'Content-Type': 'application/json', [WALLET_ACCOUNT_HEADER]: account, [AFTER_PROGRESS_HEADER]: AFTER_PROGRESS_VERSION}, body: JSON.stringify({girl, look, revision: this.profile.revision})});
      const data = await r.json(); if (epoch !== this.epoch) return false;
      if (!r.ok || !validAfterWardrobe(data) || data.selectedGirl !== girl || data.selectedLook !== look) throw Error(r.ok ? translateText('Выбор образа не подтверждён.') : data.error);
      this.profile = data; return true;
    } catch (e) { if (epoch === this.epoch) { this.error = e instanceof Error ? translateText(e.message) : translateText('Не удалось сменить образ.'); throw Error(this.error); } return false; }
    finally { if (epoch === this.epoch) { this.busy = false; this.notify(); } }
  }
  destroy() { this.epoch++; this.version++; }
}
