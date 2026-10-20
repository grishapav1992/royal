export type SlotDialogKind = '' | 'intro' | 'info' | 'history' | 'buy' | 'bonus' | 'complete';

/** Club chat and other panels own their keys even while a slot screen is open. */
export function slotOwnsKeyboard(root: HTMLElement, event: KeyboardEvent) {
  if (event.defaultPrevented || !root.isConnected) return false;
  const target = event.target;
  return !(target instanceof Element) || target === document.body || root.contains(target);
}

/** Owns modal focus and input routing. Game adapters retain the content and actions. */
export class SlotDialog {
  private priorFocus?: HTMLElement;
  private open = false;
  private disposed = false;

  constructor(
    readonly element: HTMLElement,
    private backdrop: HTMLElement,
    private actionAttribute: string,
    private action: (value: string) => void,
    private close: () => void,
  ) {
    element.onclick = event => {
      const target = event.target;
      if (this.disposed || !(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(`[${this.actionAttribute}]`);
      if (button && this.element.contains(button) && !button.disabled) {
        const value = button.getAttribute(this.actionAttribute);
        if (value) this.action(value);
      }
    };
  }

  begin(kind: SlotDialogKind) {
    if (this.disposed) return;
    if (kind && !this.open) {
      this.priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    }
    this.open = !!kind;
    this.backdrop.hidden = !kind;
    this.element.dataset.dialog = kind;
  }

  focus() {
    if (!this.disposed && this.open) this.focusable()[0]?.focus();
  }

  hide() {
    if (this.disposed) return;
    this.open = false;
    this.backdrop.hidden = true;
    const prior = this.priorFocus;
    this.priorFocus = undefined;
    if (prior?.isConnected) prior.focus();
  }

  keyboard(event: KeyboardEvent, kind: SlotDialogKind) {
    if (this.disposed || !kind) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (['info', 'history', 'buy', 'complete'].includes(kind)) this.close();
    }
    if (event.key === 'Tab') {
      const elements = this.focusable(), first = elements[0], last = elements.at(-1);
      if (!first) event.preventDefault();
      else if (!this.element.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    return true;
  }

  private focusable() {
    return Array.from(this.element.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.closest('[hidden]') && element.getClientRects().length > 0);
  }

  destroy() {
    this.disposed = true;
    this.priorFocus = undefined;
    this.element.onclick = null;
  }
}
