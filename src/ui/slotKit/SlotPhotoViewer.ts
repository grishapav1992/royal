import { t as translateText } from '../../i18n/index';
import './slot-photo-viewer.css';

/** A top-layer photo view, independent of game choices and wallet operations. */
export class SlotPhotoViewer {
  private readonly dialog = document.createElement('dialog');
  private readonly surface = document.createElement('section');
  private readonly image = document.createElement('img');
  private readonly canvas = document.createElement('div');
  private readonly title = document.createElement('h2');
  private readonly status = document.createElement('p');
  private readonly zoom = document.createElement('button');
  private readonly fullscreen = document.createElement('button');
  private priorFocus?: HTMLElement;
  private enlarged = false;
  private disposed = false;
  private fullscreenPending = false;

  constructor(root: HTMLElement, private onClose: () => void = () => {}) {
    this.dialog.className = 'slot-photo-viewer';
    this.dialog.setAttribute('aria-label', translateText('Просмотр фото'));
    this.surface.className = 'slot-photo-surface';
    const header = document.createElement('header'), tools = document.createElement('div');
    tools.className = 'slot-photo-tools';
    this.zoom.type = this.fullscreen.type = 'button';
    this.zoom.onclick = () => this.setZoom(!this.enlarged);
    this.fullscreen.textContent = '⛶';
    this.fullscreen.setAttribute('aria-label', translateText('На весь экран'));
    this.fullscreen.hidden = !document.fullscreenEnabled;
    this.fullscreen.onclick = () => void this.toggleFullscreen();
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', translateText('Закрыть фото'));
    close.onclick = () => this.close();
    tools.append(this.zoom, this.fullscreen, close);
    header.append(this.title, tools);
    this.canvas.className = 'slot-photo-canvas';
    this.image.draggable = false;
    this.image.onload = () => {
      this.status.textContent = '';
      this.zoom.disabled = false;
      this.image.style.setProperty('--photo-width', `${this.image.naturalWidth}px`);
      this.image.style.setProperty('--photo-height', `${this.image.naturalHeight}px`);
    };
    this.image.onerror = () => {
      this.status.textContent = translateText('Не удалось загрузить фото. Закрой просмотр и попробуй ещё раз.');
      this.zoom.disabled = true;
    };
    this.status.setAttribute('role', 'status');
    this.status.className = 'slot-photo-status';
    this.canvas.append(this.image);
    this.surface.append(header, this.canvas, this.status);
    this.dialog.append(this.surface);
    root.append(this.dialog);
    this.dialog.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Tab') {
        const buttons = Array.from(this.dialog.querySelectorAll<HTMLButtonElement>('button'))
          .filter(button => !button.disabled && !button.hidden && button.getClientRects().length > 0);
        const first = buttons[0], last = buttons.at(-1);
        if (!first) event.preventDefault();
        else if (!this.dialog.contains(document.activeElement) || event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === 'Escape' && !document.fullscreenElement) {
        event.preventDefault();
        this.close();
      }
    });
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
    document.addEventListener('fullscreenchange', this.fullscreenChanged);
    this.setZoom(false);
  }

  open(src: string, name: string) {
    if (this.disposed) return;
    if (!this.dialog.open) this.priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.title.textContent = name;
    this.image.alt = name;
    this.status.textContent = translateText('Загружаем фото…');
    this.zoom.disabled = true;
    this.setZoom(false);
    this.image.src = src;
    this.fullscreenChanged();
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector<HTMLButtonElement>(translateText('[aria-label="Закрыть фото"]'))!.focus();
  }

  get isOpen() { return this.dialog.open; }

  private setZoom(enlarged: boolean) {
    this.enlarged = enlarged;
    this.canvas.classList.toggle('is-enlarged', enlarged);
    this.zoom.textContent = enlarged ? translateText('Уместить') : '100%';
    this.zoom.setAttribute('aria-label', enlarged ? translateText('Уместить фото целиком') : translateText('Увеличить фото'));
    this.zoom.setAttribute('aria-pressed', String(enlarged));
    if (enlarged) {
      this.canvas.scrollLeft = Math.max(0, (this.image.naturalWidth - this.canvas.clientWidth) / 2);
      this.canvas.scrollTop = Math.max(0, (this.image.naturalHeight - this.canvas.clientHeight) / 2);
    }
  }

  private fullscreenChanged = () => {
    const own = document.fullscreenElement === this.surface;
    this.fullscreen.hidden = !document.fullscreenEnabled || !!document.fullscreenElement && !own;
    this.fullscreen.textContent = own ? '↙' : '⛶';
    this.fullscreen.setAttribute('aria-label', own ? translateText('Выйти из полного экрана') : translateText('На весь экран'));
  };

  private async toggleFullscreen() {
    if (this.disposed || this.fullscreenPending) return;
    this.fullscreenPending = true;
    try {
      if (document.fullscreenElement === this.surface) await document.exitFullscreen();
      else if (!document.fullscreenElement) {
        await this.surface.requestFullscreen();
        if ((!this.dialog.open || this.disposed) && document.fullscreenElement === this.surface) await document.exitFullscreen();
      }
    } catch {
      if (!this.disposed && this.dialog.open) this.status.textContent = translateText('Фото уже развёрнуто на всё окно. Браузер не разрешил скрыть свои панели.');
    } finally {
      this.fullscreenPending = false;
    }
  }

  close() {
    if (document.fullscreenElement === this.surface) void document.exitFullscreen().catch(() => {});
    if (!this.dialog.open) return;
    this.dialog.close();
    if (this.priorFocus?.isConnected) this.priorFocus.focus();
    this.priorFocus = undefined;
    this.onClose();
  }

  destroy() {
    this.disposed = true;
    this.close();
    document.removeEventListener('fullscreenchange', this.fullscreenChanged);
    this.image.onload = this.image.onerror = null;
    this.dialog.remove();
  }
}
