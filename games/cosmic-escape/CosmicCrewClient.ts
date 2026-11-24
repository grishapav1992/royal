import {WALLET_ACCOUNT_HEADER} from '../../src/shared/walletAccount';
import {validCosmicCrewProfile, type CosmicCrewId, type CosmicCrewProfile, type CosmicCrewRequest} from '../../src/shared/cosmicCrew';

/** Cosmetic account profile. It never holds a wallet operation, and a failure only hides the progress. */
export class CosmicCrewClient extends EventTarget {
  account: string | null = null; profile?: CosmicCrewProfile; loading = false; busy = false; failed = false; refused = '';
  private wanted?: CosmicCrewRequest; private epoch = 0; private again = false; private disposed = false; private pending = new AbortController();
  private notify() { if (!this.disposed) this.dispatchEvent(new Event('change')); }
  setAccount(account: string | null) {
    if (this.disposed || account === this.account) return;
    this.epoch++; this.pending.abort(); this.pending = new AbortController();
    this.account = account; this.profile = undefined; this.wanted = undefined; this.loading = this.busy = this.again = this.failed = false; this.refused = '';
    this.notify();
    if (account) void this.refresh();
  }
  private async call(body?: CosmicCrewRequest) {
    const account = this.account!, timer = new AbortController(), timeout = setTimeout(() => timer.abort(), 10000);
    try {
      const reply = await fetch('/api/cosmic-crew', {method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([this.pending.signal, timer.signal]),
        headers: {[WALLET_ACCOUNT_HEADER]: account, ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
      const data: unknown = await reply.json();
      if (!reply.ok) throw Object.assign(Error('crew'), {code: String((data as {error?: unknown})?.error ?? '')});
      if (!validCosmicCrewProfile(data) || data.accountId !== account) throw Error('crew');
      return data;
    } finally { clearTimeout(timeout); }
  }
  /** Replies can overtake each other. A profile never goes back to an older revision. */
  private accept(profile: CosmicCrewProfile) { if (!this.profile || profile.revision >= this.profile.revision) this.profile = profile; this.failed = false;
    // A lost reply can hide a saved choice. The next profile answers it.
    const wanted = this.wanted; if (wanted && this.profile && (wanted.action === 'select' ? this.profile.selected === wanted.characterId : this.profile.revealed.includes(wanted.characterId))) { this.wanted = undefined; this.refused = ''; }
  }
  async refresh() {
    if (this.disposed || !this.account) return;
    if (this.loading || this.busy) { this.again = true; return; }
    const epoch = this.epoch; this.loading = true; this.notify();
    try { const profile = await this.call(); if (epoch === this.epoch) this.accept(profile); }
    catch { if (epoch === this.epoch) this.failed = true; }
    finally { if (epoch === this.epoch && !this.disposed) { this.loading = false; this.notify(); this.repeat(); } }
  }
  async act(action: CosmicCrewRequest['action'], characterId: CosmicCrewId) {
    if (this.disposed || !this.account || this.busy) return false;
    const epoch = this.epoch; this.busy = true; this.refused = ''; this.wanted = undefined; this.notify();
    try { const profile = await this.call({action, characterId}); if (epoch !== this.epoch) return false; this.accept(profile); return true; }
    catch (error) { if (epoch === this.epoch) this.refused = (error as {code?: string}).code === 'round-active' ? 'round-active' : 'failed'; if (epoch === this.epoch && this.refused === 'failed') { this.wanted = {action, characterId}; this.again = true; } return false; }
    finally { if (epoch === this.epoch && !this.disposed) { this.busy = false; this.notify(); this.repeat(); } }
  }
  private repeat() { if (this.again && !this.loading && !this.busy) { this.again = false; void this.refresh(); } }
  destroy() { this.disposed = true; this.epoch++; this.pending.abort(); }
}
