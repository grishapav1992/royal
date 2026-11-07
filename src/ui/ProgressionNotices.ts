import { language } from '../i18n/index';
import { formatNileUnits } from '../shared/nileWallet';
import { rewardGames, type ProgressionSnapshot } from '../shared/progression';
import type { ProgressionClient } from '../wallet/ProgressionClient';
import { demoWallet } from '../wallet/WalletClient';
import { GAME_ROUND_PRESENTED_EVENT } from './gameReactions';
import './progression-notices.css';

const en = language === 'en';
const levelText = (level: number) => en ? `Level ${level}` : `Уровень ${level}`;
const gameNames = { 'royal-coins': 'Royal Coins', 'royal-fruits': 'Royal Fruits' };
const bannerTime = 1200;

export class ProgressionNotices {
  private dialog = document.createElement('dialog');
  private banner = document.createElement('div');
  private title = document.createElement('h2');
  private rewards = document.createElement('ul');
  private error = document.createElement('p');
  private ok = document.createElement('button');
  private account: string | null = null;
  private level?: number;
  private displayedReward?: number;
  private bannerTimer?: ReturnType<typeof setTimeout>;
  private waitingForResult = false;
  private presentationRevision = 0;
  private gameDialog = document.querySelector<HTMLDialogElement>('#mini-dialog');

  constructor(private client: ProgressionClient, private setLocked: (locked: boolean) => void) {
    this.banner.className = 'level-up-banner';
    this.banner.setAttribute('popover', 'manual');
    this.banner.setAttribute('role', 'status');
    this.dialog.className = 'level-reward-dialog';
    this.dialog.id = 'level-reward-dialog';
    this.dialog.setAttribute('aria-labelledby', 'level-reward-title');
    this.title.id = 'level-reward-title';
    const summary = document.createElement('p');
    summary.textContent = en ? 'Your rewards are in My rewards.' : 'Награды начислены и доступны в разделе «Мои награды».';
    this.error.setAttribute('role', 'alert');
    this.ok.className = 'primary-button';
    this.ok.type = 'button';
    this.ok.textContent = 'OK';
    this.ok.autofocus = true;
    this.ok.onclick = () => { void this.acknowledge(); };
    this.dialog.append(this.title, summary, this.rewards, this.error, this.ok);
    document.body.append(this.banner, this.dialog);
    this.dialog.addEventListener('cancel', event => event.preventDefault());
    this.dialog.addEventListener('close', () => {
      if (!this.dialog.open) this.setLocked(!!document.querySelector('dialog[open]'));
    });
    client.addEventListener('change', () => this.render());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.hideBanner();
      else this.render();
    });
    document.addEventListener(GAME_ROUND_PRESENTED_EVENT, event => {
      if (!(event.target instanceof Node) || !this.gameDialog?.contains(event.target)) return;
      const revision = this.presentationRevision;
      // The round's final UI can be updated in the same event loop turn.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!this.gameDialog?.open || revision !== this.presentationRevision) return;
        this.waitingForResult = false;
        void client.refresh();
        this.render();
      }));
    });
    demoWallet.addEventListener('change', () => {
      if (this.gameRequestInProgress()) {
        this.waitingForResult = true;
        this.presentationRevision++;
      }
    });
    new MutationObserver(records => {
      const changed = records.filter(({ target }) => target instanceof HTMLDialogElement && target !== this.dialog);
      if (!changed.length) return;
      if (changed.some(({ target }) => target === this.gameDialog)) {
        this.waitingForResult = this.gameRequestInProgress();
        this.presentationRevision++;
      }
      this.render();
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['open', 'data-phase', 'data-game'] });
    this.render();
  }

  private gameRequestInProgress() {
    const kind = demoWallet.pending?.kind;
    return !!this.gameDialog?.open && (kind === 'play' || kind === 'spin' || demoWallet.hasExternalBusy('progression'));
  }

  private render() {
    const { accountId, snapshot } = this.client;
    if (accountId !== this.account) {
      this.account = accountId;
      this.level = this.displayedReward = undefined;
      this.waitingForResult = this.gameRequestInProgress();
      this.presentationRevision++;
      this.ok.disabled = false;
      this.error.textContent = '';
      this.hideBanner();
      this.dialog.close();
    }
    if (!snapshot || document.hidden || document.querySelector('#join-dialog[open]')) return;
    this.level ??= snapshot.level;
    if ((this.gameDialog?.open && this.waitingForResult) || document.querySelector('#pvp-dialog[open][data-phase="playing"]')) return;
    if (snapshot.level > this.level && !this.bannerTimer && !this.dialog.open) {
      this.level = snapshot.level;
      this.showBanner(snapshot.level);
      return;
    }
    if (this.bannerTimer || this.ok.disabled) return;
    const reward = snapshot.pendingRewardLevels?.[0];
    if (reward === undefined) {
      this.displayedReward = undefined;
      this.dialog.close();
    } else if (reward !== this.displayedReward || !this.dialog.open) {
      this.showReward(snapshot, reward);
    }
  }

  private showBanner(level: number) {
    this.banner.textContent = `${levelText(level)}!`;
    // Putting it inside the active dialog also keeps the announcement accessible.
    const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
    (open[open.length - 1] ?? document.body).append(this.banner);
    this.banner.showPopover();
    this.bannerTimer = setTimeout(() => {
      this.hideBanner();
      this.render();
    }, bannerTime);
  }

  private hideBanner() {
    clearTimeout(this.bannerTimer);
    this.bannerTimer = undefined;
    if (this.banner.matches(':popover-open')) this.banner.hidePopover();
  }

  private showReward(snapshot: ProgressionSnapshot, level: number) {
    const lines: string[] = [];
    for (const grant of snapshot.grants.filter(grant => grant.level === level)) {
      const amount = formatNileUnits(grant.stakeUnits);
      const stake = snapshot.currency === 'VIRTUAL_USD' ? `$${amount}` : `${amount} ${snapshot.currency}`;
      const games = rewardGames(grant).map(game => gameNames[game]).join(en ? ' or ' : ' или ');
      lines.push(en ? `Free spins: ${grant.count} at ${stake} each. Available in ${games}.`
        : `Бесплатные спины: ${grant.count} по ${stake} за спин. Доступны в ${games}.`);
    }
    for (const grant of snapshot.skinGrants?.filter(grant => grant.level === level) ?? []) {
      lines.push(en ? `Free skin generations: ${grant.count}. Each gives two designs to choose from.`
        : `Бесплатные генерации скина: ${grant.count}. Каждая даёт два образа на выбор.`);
    }
    if (!lines.length) return;
    this.displayedReward = level;
    this.title.textContent = en ? `Level ${level} rewards` : `Награды за ${level}-й уровень`;
    this.rewards.replaceChildren(...lines.map(line => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    }));
    this.error.textContent = '';
    if (!this.dialog.open) {
      this.setLocked(true);
      this.dialog.showModal();
    }
    this.ok.focus({ preventScroll: true });
  }

  private async acknowledge() {
    const level = this.displayedReward, account = this.account;
    if (level === undefined || this.ok.disabled) return;
    this.ok.disabled = true;
    this.error.textContent = '';
    try {
      await this.client.acknowledgeReward(level);
    } catch {
      if (account === this.account) this.error.textContent = en ? 'Could not save. Press OK again.' : 'Не удалось сохранить. Нажми «ОК» ещё раз.';
    } finally {
      if (account === this.account) {
        this.ok.disabled = false;
        this.render();
      }
    }
  }
}
