import './game-priority-panel.css';

/** Adapt to the space supplied by the real host, including its chat column.
 * Existing controls move into the panel temporarily, keeping their state and listeners. */
export class GamePriorityPanel {
  private readonly dialog: HTMLDialogElement;
  private readonly content: HTMLElement;
  private readonly observer: ResizeObserver;
  private readonly lifetime = new AbortController();
  private homes: { node: HTMLElement; marker: Comment }[] = [];
  private previousFocus?: HTMLElement;

  constructor(private root: HTMLElement, private trigger: HTMLButtonElement, title: string,
    closeLabel: string, private nodes: HTMLElement[]) {
    const doc = root.ownerDocument;
    this.dialog = doc.createElement('dialog');
    this.dialog.className = 'game-options-panel';
    this.dialog.setAttribute('aria-label', title);
    const header = doc.createElement('header'), heading = doc.createElement('h2');
    heading.textContent = title;
    const close = doc.createElement('button');
    close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', closeLabel);
    header.append(heading, close);
    this.content = doc.createElement('div'); this.content.className = 'game-options-content';
    this.dialog.append(header, this.content); root.append(this.dialog);
    trigger.classList.add('game-options-trigger'); trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    const signal = this.lifetime.signal;
    trigger.addEventListener('click', () => this.open(), { signal });
    close.addEventListener('click', () => this.close(), { signal });
    this.dialog.addEventListener('cancel', e => { e.preventDefault(); e.stopPropagation(); this.close(); }, { signal });
    this.dialog.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    }, { signal });
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.restore(); }, { signal });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(root); this.resize();
  }
  private resize() {
    const { width, height } = this.root.getBoundingClientRect();
    this.root.dataset.priorityLayout = width >= 900 && height >= 600 ? 'full' : width > height && height < 600 ? 'landscape' : 'portrait';
    if (this.root.dataset.priorityLayout === 'full') this.close();
  }
  private open() {
    if (this.dialog.open) return;
    this.previousFocus = this.trigger;
    this.homes = this.nodes.map(node => {
      const marker = this.root.ownerDocument.createComment('game option'); node.before(marker);
      this.content.append(node); return { node, marker };
    });
    this.trigger.setAttribute('aria-expanded', 'true'); this.dialog.showModal();
  }
  private restore() {
    for (const { node, marker } of this.homes) { marker.replaceWith(node); }
    this.homes = []; this.trigger.setAttribute('aria-expanded', 'false');
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    this.previousFocus = undefined;
  }
  close() { if (this.dialog.open) { this.dialog.close(); this.restore(); } }
  destroy() { this.close(); this.lifetime.abort(); this.observer.disconnect(); this.dialog.remove(); delete this.root.dataset.priorityLayout; }
}
