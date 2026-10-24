import { t as translateText, tr } from '../i18n/index';
import { isRetiredArcadeGame } from '../shared/arcadeCatalog';
import { EXPANSION_NAMES, type ExpansionGameId } from '../shared/casinoExpansion';
import { expansionClient as client } from '../wallet/ExpansionClient';
import { demoWallet } from '../wallet/WalletClient';
import { minesClient } from '../wallet/MinesClient';
import './retired-arcade-rounds.css';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
export type RetiredArcadeRound = { accountId: string; gameId: ExpansionGameId | 'royal-mines'; sessionId: string };
export const retiredGameName = (id: RetiredArcadeRound['gameId']) => id === 'royal-mines' ? 'Royal Mines' : EXPANSION_NAMES[id];
export const ownsRetiredArcadeRound = (round: RetiredArcadeRound) =>
  isRetiredArcadeGame(round.gameId) && client.accountId === round.accountId && demoWallet.accountId === round.accountId
  && (round.gameId === 'royal-mines' ? minesClient.accountId === round.accountId && minesClient.session?.id === round.sessionId && minesClient.session.state === 'active'
    : client.sessions.some(session => session.gameId === round.gameId && session.id === round.sessionId && session.state === 'active'));

/** Removed games are reachable only to finish an existing round or confirm its saved request. */
export class RetiredArcadeRounds {
  private destroyed = false;
  private checking = false;
  private error = '';
  private change = () => this.render();

  constructor(private host: HTMLElement, private open: (round: RetiredArcadeRound) => Promise<void>) {
    client.addEventListener('change', this.change);
    minesClient.addEventListener('change', this.change);
    demoWallet.addEventListener('change', this.change);
    this.render();
  }

  private render() {
    if (this.destroyed) return;
    const account = client.accountId;
    const owned = !!account && account === demoWallet.accountId;
    const sessions: { id: string; gameId: RetiredArcadeRound['gameId'] }[] = owned ? client.sessions.filter(session => session.state === 'active' && isRetiredArcadeGame(session.gameId)) : [];
    if (owned && minesClient.accountId === account && minesClient.session?.state === 'active') sessions.push({id:minesClient.session.id,gameId:'royal-mines'});
    const pending = owned && client.pending && isRetiredArcadeGame(client.pending.gameId) ? client.pending : owned && minesClient.accountId === account && minesClient.pending ? {...minesClient.pending,gameId:'royal-mines' as const} : undefined;
    const visible = sessions.length > 0 || !!pending;
    this.host.hidden = !visible;
    if (!visible) { this.host.replaceChildren(); return; }
    const blocked = this.checking || client.busy || client.loading || minesClient.busy || minesClient.loading;
    this.host.innerHTML = tr`<section class="retired-arcade-rounds" aria-label="Сохранённые партии"><h3>Завершить сохранённое</h3><p>Эти игры убраны из зала. Сохранённую партию можно закончить, прежний ход можно проверить.</p>${pending ? tr`<button type="button" data-retired-retry ${blocked ? 'disabled' : ''}><strong>${escape(retiredGameName(pending.gameId))}</strong><span>Проверить прежний ход</span></button>` : ''}${sessions.map(session => tr`<button type="button" data-retired-session="${session.id}" ${blocked ? 'disabled' : ''}><strong>${escape(retiredGameName(session.gameId))}</strong><span>Продолжить сохранённую партию</span></button>`).join('')}<p class="retired-round-error" role="status">${escape(this.error || client.error || (blocked ? translateText('Проверяем сохранённую партию…') : ''))}</p></section>`;
    this.host.querySelector<HTMLButtonElement>('[data-retired-retry]')?.addEventListener('click', () => {
      if (account && pending) void this.retry(account, pending.id, pending.gameId === 'royal-mines');
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-retired-session]').forEach(button => {
      const session = sessions.find(value => value.id === button.dataset.retiredSession);
      if (account && session) button.onclick = () => void this.resume({accountId:account, gameId:session.gameId, sessionId:session.id});
    });
  }

  private async retry(accountId: string, requestId: string, mines = false) {
    const target = mines ? minesClient : client;
    if (this.checking || client.busy || client.loading || client.accountId !== accountId || demoWallet.accountId !== accountId
      || target.pending?.id !== requestId) return;
    this.checking = true; this.error = ''; this.render();
    try { await target.retry(); }
    catch (error) { if (client.accountId === accountId) this.error = (error as Error).message; }
    finally { this.checking = false; this.render(); }
  }

  private async resume(round: RetiredArcadeRound) {
    if (this.checking || client.busy || client.loading || !ownsRetiredArcadeRound(round)) return;
    this.checking = true; this.error = ''; this.render();
    try {
      const target = round.gameId === 'royal-mines' ? minesClient : client;
      await target.refresh();
      if (target.error) throw Error(target.error);
      if (this.destroyed || !ownsRetiredArcadeRound(round)) return;
      await this.open(round);
    } catch (error) { if (client.accountId === round.accountId) this.error = (error as Error).message; }
    finally { this.checking = false; this.render(); }
  }

  destroy() {
    this.destroyed = true;
    client.removeEventListener('change', this.change);
    minesClient.removeEventListener('change', this.change);
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
    const target = event.target instanceof Element ? event.target.closest('[data-start], #original-play') : null;
    if (!this.sameAccount() || target && (this.round.gameId !== 'royal-mines' || minesClient.session?.state !== 'active')) {
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
    minesClient.addEventListener('change', this.change);
    demoWallet.addEventListener('change', this.change);
    this.update();
  }

  private sameAccount() { return client.accountId === this.round.accountId && demoWallet.accountId === this.round.accountId; }
  private update() {
    if (this.destroyed) return;
    if (!this.sameAccount()) { this.close(); return; }
    const session = this.round.gameId === 'royal-mines' ? minesClient.session?.id === this.round.sessionId ? minesClient.session : undefined : client.sessions.find(value => value.gameId === this.round.gameId && value.id === this.round.sessionId);
    const active = session?.state === 'active';
    this.note.textContent = active ? translateText('Сохранённая партия. Можно завершить её по прежним правилам.') : translateText('Партия завершена. Новые ставки в этой игре закрыты.');
    this.host.querySelectorAll<HTMLButtonElement>(this.round.gameId === 'royal-mines' && !active ? '#original-play' : 'button[data-start]').forEach(button => {
      if (!button.disabled) button.disabled = true;
      button.setAttribute('aria-label', translateText('Новые ставки в этой игре закрыты'));
    });
    if (!session) this.close();
  }

  destroy() {
    this.destroyed = true; this.observer.disconnect();
    this.host.removeEventListener('click', this.capture, true);
    client.removeEventListener('change', this.change);
    minesClient.removeEventListener('change', this.change);
    demoWallet.removeEventListener('change', this.change);
    this.note.remove();
  }
}
