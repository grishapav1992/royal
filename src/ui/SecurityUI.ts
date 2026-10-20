import { t as translateText, tr } from '../i18n/index';
import type { SecurityDecision } from '../shared/security';
import type { RoomScene } from '../game/RoomScene';

export class SecurityUI {
  private dialog = document.createElement('dialog');
  private until = 0;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private scene: RoomScene, retry: () => void) {
    this.dialog.id = 'security-dialog'; this.dialog.className = 'security-dialog';
    this.dialog.setAttribute('aria-labelledby', 'security-title');
    this.dialog.innerHTML = translateText('<div class="security-night"><span class="security-sign">ROYAL</span><span class="security-closed">ПАУЗА НА ВХОД</span><img alt="Охранник клуба"/></div><span class="eyebrow">ОХРАНА КЛУБА</span><h2 id="security-title">На сегодня без грубостей.</h2><p>Вход закрыт за повторные оскорбления или спам.</p><p id="security-time" role="status"></p><button class="primary-button" id="security-return" disabled>Вернуться в зал</button>');
    document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', event => event.preventDefault());
    this.dialog.querySelector('button')!.addEventListener('click', () => {
      if (Date.now() < this.until) return;
      this.dialog.close(); clearInterval(this.timer); this.until = 0;
      this.scene.setSecurity(false); retry();
    });
  }
  get active() { return this.until > 0; }
  intervention(decision: SecurityDecision) {
    if(decision.reason)this.dialog.querySelector('h2 + p')!.textContent=decision.reason==='collision'?translateText('Вход закрыт за толчки охранника.'):translateText('Вход закрыт за повторные оскорбления или спам.');
    for (const dialog of Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))) dialog.close();
    this.scene.setSecurity(true);
    document.querySelector<HTMLInputElement>('#chat-input')?.blur();
  }
  ejected(until: number) {
    if (this.until) return;
    this.until = until; this.intervention({kind:'ejecting',until});
    this.dialog.querySelector('img')!.src = this.scene.textures.getBase64('security-guard','down-6');
    this.dialog.showModal();
    this.dialog.querySelector('h2')!.textContent = translateText('Охранник попросил на выход.');
    const update = () => {
      const seconds = Math.max(0, Math.ceil((this.until-Date.now())/1000));
      this.dialog.querySelector('#security-time')!.textContent = seconds ? tr`Вернуться можно через ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}` : translateText('Можно вернуться в зал.');
      this.dialog.querySelector<HTMLButtonElement>('button')!.disabled = seconds > 0;
    };
    update(); this.timer = setInterval(update,1000);
  }
}
