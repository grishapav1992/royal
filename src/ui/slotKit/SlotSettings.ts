import { t as translateText } from '../../i18n/index';
import './slot-settings.css';

/** Keeps occasional controls out of the cabinet while preserving their existing bindings. */
export class SlotSettings {
  private readonly dialog = document.createElement('dialog');
  private readonly button = document.createElement('button');
  private readonly placeholder = document.createComment('slot settings');

  constructor(root: HTMLElement, private readonly footer: HTMLElement, tools: HTMLElement, onOpen: () => void) {
    footer.before(this.placeholder);
    this.button.type = 'button';
    this.button.className = 'slot-settings-button';
    this.button.textContent = '⚙';
    this.button.setAttribute('aria-label', translateText('Настройки игры'));
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.dialog.className = 'slot-settings-dialog';
    this.dialog.setAttribute('aria-label', translateText('Настройки игры'));
    this.dialog.innerHTML = translateText('<header><h2>Настройки игры</h2><button type="button" aria-label="Закрыть настройки">×</button></header><p>Звук, отображение и связь с кошельком.</p>');
    this.dialog.append(footer);
    root.append(this.dialog);
    tools.append(this.button);
    this.button.onclick = () => {
      if (this.dialog.open) return;
      onOpen();
      this.dialog.showModal();
    };
    this.dialog.querySelector('header button')!.addEventListener('click', () => this.close());
    // The topmost modal owns Escape, Tab and Space, including the club's keyboard shortcuts.
    this.dialog.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(this.dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
      )).filter(element => element.getClientRects().length > 0 && !element.closest('[hidden]'));
      const first = focusable[0], last = focusable.at(-1);
      if (!first) event.preventDefault();
      else if (!this.dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    this.dialog.addEventListener('cancel', event => event.stopPropagation());
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const rect = this.dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.close();
    });
    const refresh = footer.querySelector<HTMLButtonElement>('[data-cc-refresh], [data-lg-refresh]');
    if (refresh) {
      refresh.textContent = translateText('Обновить данные игры');
      refresh.title = translateText('Проверить сохранённый ход и связь с кошельком. Новая ставка не делается.');
    }
  }

  close() { if (this.dialog.open) this.dialog.close(); }

  destroy() {
    this.close();
    this.button.onclick = null;
    this.button.remove();
    this.placeholder.replaceWith(this.footer);
    this.dialog.remove();
  }
}
