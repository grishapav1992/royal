import { t as translateText, tr } from '../i18n/index';
import { isRetiredArcadeGame } from '../shared/arcadeCatalog';
import { EXPANSION_NAMES, type ExpansionGameId } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import './retired-arcade-rounds.css';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
export type RetiredArcadeRound = { accountId: string; gameId: ExpansionGameId; sessionId: string };
export const ownsRetiredArcadeRound = (round: RetiredArcadeRound) =>
  isRetiredArcadeGame(round.gameId) && client.accountId === round.accountId && demoWallet.accountId === round.accountId
  && client.sessions.some(session => session.gameId === round.gameId && session.id === round.sessionId && session.state === 'active');

/** Removed games are reachable only to finish an existing round or confirm its saved request. */
export class RetiredArcadeRounds {
  private destroyed = false;
  private checking = false;
  private error = '';
  private change = () => this.render();

  constructor(private host: HTMLElement, private open: (round: RetiredArcadeRound) => Promise<void>) {
    client.addEventListener('change', this.change);
    demoWallet.addEventListener('change', this.change);
    this.render();
  }

  private render() {
    if (this.destroyed) return;
    const account = client.accountId;
    const owned = !!account && account === demoWallet.accountId;
    const sessions = owned ? client.sessions.filter(session => session.state === 'active' && isRetiredArcadeGame(session.gameId)) : [];
    const pending = owned && client.pending && isRetiredArcadeGame(client.pending.gameId) ? client.pending : undefined;
    const visible = sessions.length > 0 || !!pending;
    this.host.hidden = !visible;
    if (!visible) { this.host.replaceChildren(); return; }
    const blocked = this.checking || client.busy || client.loading;
    this.host.innerHTML = tr`<section class="retired-arcade-rounds" aria-label="Сохранённые партии"><h3>Завершить сохранённое</h3><p>Эти игры убраны из зала. Сохранённую партию можно закончить, прежний ход можно проверить.</p>${pending ? tr`<button type="button" data-retired-retry ${blocked ? 'disabled' : ''}><strong>${escape(EXPANSION_NAMES[pending.gameId])}</strong><span>Проверить прежний ход</span></button>` : ''}${sessions.map(session => tr`<button type="button" data-retired-session="${session.id}" ${blocked ? 'disabled' : ''}><strong>${escape(EXPANSION_NAMES[session.gameId])}</strong><span>Продолжить сохранённую партию</span></button>`).join('')}<p class="retired-round-error" role="status">${escape(this.error || client.error || (blocked ? translateText('Проверяем сохранённую партию…') : ''))}</p></section>`;
    this.host.querySelector<HTMLButtonElement>('[data-retired-retry]')?.addEventListener('click', () => {
      if (account && pending) void this.retry(account, pending.id);
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-retired-session]').forEach(button => {
      const session = sessions.find(value => value.id === button.dataset.retiredSession);
      if (account && session) button.onclick = () => void this.resume({accountId:account, gameId:session.gameId, sessionId:session.id});
    });
  }

  private async retry(accountId: string, requestId: string) {
    if (this.checking || client.busy || client.loading || client.accountId !== accountId || demoWallet.accountId !== accountId
      || client.pending?.id !== requestId || !isRetiredArcadeGame(client.pending.gameId)) return;
    this.checking = true; this.error = ''; this.render();
    try { await client.retry(); }
    catch (error) { if (client.accountId === accountId) this.error = (error as Error).message; }
    finally { this.checking = false; this.render(); }
  }

  private async resume(round: RetiredArcadeRound) {
    if (this.checking || client.busy || client.loading || !ownsRetiredArcadeRound(round)) return;
    this.checking = true; this.error = ''; this.render();
    try {
      await client.refresh();
      if (client.error) throw Error(client.error);
      if (this.destroyed || !ownsRetiredArcadeRound(round)) return;
      await this.open(round);
    } catch (error) { if (client.accountId === round.accountId) this.error = (error as Error).message; }
    finally { this.checking = false; this.render(); }
  }

  destroy() {
    this.destroyed = true;
    client.removeEventListener('change', this.change);
    demoWallet.removeEventListener('change', this.change);
    this.host.replaceChildren();
  }
}

/** Existing game views retain their history and moves, while every fresh-start control is disabled. */
export class RetiredArcadeRoundGuard {
  private observer: MutationObserver;
  private note = document.createElement('p');
  private destroyed = false;
  private change = () => this.update();
  private capture = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-start]') : null;
    if (!this.sameAccount() || target) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };

  constructor(private host: HTMLElement, private round: RetiredArcadeRound, private close: () => void) {
    this.note.className = 'retired-round-note'; this.note.setAttribute('role', 'status');
    this.host.before(this.note);
    this.host.addEventListener('click', this.capture, true);
    this.observer = new MutationObserver(() => this.update());
    this.observer.observe(this.host, {childList:true, subtree:true, attributes:true, attributeFilter:['data-start','disabled']});
    client.addEventListener('change', this.change);
    demoWallet.addEventListener('change', this.change);
    this.update();
  }

  private sameAccount() { return client.accountId === this.round.accountId && demoWallet.accountId === this.round.accountId; }
  private update() {
    if (this.destroyed) return;
    if (!this.sameAccount()) { this.close(); return; }
    const session = client.sessions.find(value => value.gameId === this.round.gameId && value.id === this.round.sessionId);
    const active = session?.state === 'active';
    this.note.textContent = active ? translateText('Сохранённая партия. Можно завершить её по прежним правилам.') : translateText('Партия завершена. Новые ставки в этой игре закрыты.');
    this.host.querySelectorAll<HTMLButtonElement>('button[data-start]').forEach(button => {
      if (!button.disabled) button.disabled = true;
      button.setAttribute('aria-label', translateText('Новые ставки в этой игре закрыты'));
    });
    if (!session) this.close();
  }

  destroy() {
    this.destroyed = true; this.observer.disconnect();
    this.host.removeEventListener('click', this.capture, true);
    client.removeEventListener('change', this.change);
    demoWallet.removeEventListener('change', this.change);
    this.note.remove();
  }
}
