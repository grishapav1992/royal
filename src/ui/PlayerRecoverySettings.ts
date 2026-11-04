import { t } from '../i18n/index';
import './player-recovery.css';

export function installPlayerRecoverySettings(settings: HTMLDialogElement, recover: () => Promise<boolean>) {
  const help = document.createElement('section');
  help.className = 'player-recovery-settings'; help.setAttribute('aria-labelledby', 'player-recovery-title');
  help.innerHTML = t('<h3 id="player-recovery-title">Помощь</h3><button type="button" id="recover-player" class="text-button">Персонаж застрял</button><p>Вернуться ко входу на этаж. Игровой прогресс сохранится.</p><p id="player-recovery-status" role="status" hidden></p>');
  settings.append(help);
  const button = help.querySelector<HTMLButtonElement>('button')!, status = help.querySelector<HTMLParagraphElement>('[role="status"]')!;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true; status.hidden = false; status.textContent = t('Возвращаем персонажа ко входу…');
    try {
      if (await recover()) { status.hidden = true; }
      else status.textContent = t('Возврат не подтверждён. Проверь подключение или заверши совместную игру и попробуй ещё раз.');
    } catch { status.textContent = t('Не удалось вернуть персонажа. Проверь подключение и попробуй ещё раз.'); }
    finally { button.disabled = false; }
  });
}
