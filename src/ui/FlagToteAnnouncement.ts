import { flagToteClient } from '../wallet/FlagToteClient';
import { language } from '../i18n/index';
import './flag-tote-announcement.css';

/** A single invitation opens the same pool from every room and floor. */
export class FlagToteAnnouncement {
  private button = document.createElement('button');
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval>;
  constructor(host: HTMLElement, open: () => void) {
    this.button.type = 'button'; this.button.className = 'flag-tote-announcement'; this.button.hidden = true;
    this.button.addEventListener('click', e => { e.stopPropagation(); open(); }); host.append(this.button);
    const update = () => {
      const round = flagToteClient.snapshot?.round;
      this.button.hidden = !flagToteClient.accountId || !round;
      if (!round) return;
      const en = language === 'en', left = Math.max(0, Math.ceil((round.closesAt - flagToteClient.serverTime()) / 1000));
      const status = round.state === 'open' && left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2,'0')} · ${en ? 'betting open' : 'приём ставок'}` : round.state === 'racing' ? en ? 'Race in progress' : 'Битва идёт' : en ? 'Results and next round' : 'Результаты и следующий раунд';
      this.button.replaceChildren();
      const title = document.createElement('strong'); title.textContent = en ? '⚑ Flag totalizator' : '⚑ Флаговый тотализатор';
      const info = document.createElement('span'); info.textContent = `${status} · ${(Number(round.potUnits) / 100).toLocaleString(en ? 'en-US' : 'ru-RU')} USDT`;
      this.button.append(title, info);
    };
    this.unsubscribe = flagToteClient.subscribe(update); this.timer = setInterval(update, 1000); update();
  }
  destroy() { this.unsubscribe(); clearInterval(this.timer); this.button.remove(); }
}
