import { gameContentLayout } from '../GameLayoutPolicy';

/** The iframe's own viewport is the space already allocated by the host and chat. */
export class FrameLayout {
  private readonly observer: ResizeObserver;
  constructor(private root: HTMLElement, changed?: (compact: boolean) => void) {
    const fit = () => {
      const profile = gameContentLayout(root.clientWidth, root.clientHeight);
      if (root.dataset.frameLayout === profile) return;
      root.dataset.frameLayout = profile;
      changed?.(profile !== 'full');
    };
    this.observer = new ResizeObserver(fit); this.observer.observe(root); fit();
  }
  destroy() { this.observer.disconnect(); delete this.root.dataset.frameLayout; }
}

/** Occasional controls retain their handlers and values when moved into the panel. */
export class FrameOptions {
  private readonly dialog: HTMLDialogElement;
  private readonly button: HTMLButtonElement;
  private readonly layout: FrameLayout;
  private compact = false;
  private homes: { node: HTMLElement; marker: Comment }[] = [];
  constructor(root: HTMLElement, controls: HTMLElement, nodes: HTMLElement[], title: string, close: string, onOpen: () => void = () => {}) {
    const doc = root.ownerDocument;
    this.dialog = doc.createElement('dialog'); this.dialog.className = 'frame-options';
    this.dialog.setAttribute('aria-label', title);
    const header = doc.createElement('header'), heading = doc.createElement('h2'), dismiss = doc.createElement('button');
    heading.textContent = title; dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', close);
    header.append(heading, dismiss); this.dialog.append(header); root.append(this.dialog);
    this.button = doc.createElement('button'); this.button.type = 'button'; this.button.className = 'frame-options-button';
    this.button.textContent = '⚙'; this.button.setAttribute('aria-label', title); this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-expanded', 'false'); controls.append(this.button);
    this.button.onclick = () => { onOpen(); this.dialog.showModal(); this.button.setAttribute('aria-expanded', 'true'); };
    dismiss.onclick = () => this.close();
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); this.close(); });
    this.dialog.addEventListener('keydown', event => event.stopPropagation());
    this.dialog.addEventListener('click', event => { if ((event.target as Element).closest('#rules')) this.close(); }, true);
    this.layout = new FrameLayout(root, compact => {
      this.button.hidden = !compact;
      if (compact === this.compact) return;
      this.compact = compact;
      if (compact) for (const node of nodes) {
        const marker = doc.createComment('frame option'); node.before(marker); this.homes.push({ node, marker });
        if (node.matches('select')) { const label = doc.createElement('label'); label.textContent = node.getAttribute('aria-label'); label.append(node); this.dialog.append(label); }
        else this.dialog.append(node);
      }
      else { this.close(); this.restore(); }
    });
  }
  private restore() {
    for (const { node, marker } of this.homes.reverse()) marker.replaceWith(node);
    this.homes = []; this.dialog.querySelectorAll(':scope>label').forEach(node => node.remove());
  }
  close() { if (this.dialog.open) { this.dialog.close(); this.button.setAttribute('aria-expanded', 'false'); this.button.focus({ preventScroll: true }); } }
  destroy() { this.close(); this.layout.destroy(); this.restore(); this.dialog.remove(); this.button.remove(); }
}

export const frameOptionsStyles = String.raw`
.frame-options{box-sizing:border-box;position:fixed;inset:0;margin:auto;width:min(520px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;padding:16px;background:#18382d;color:#eff9df;border:1px solid #b6ceb1;border-radius:10px;text-align:left;outline:0}
.frame-options::backdrop{background:#061810bb}.frame-options>header{display:flex;justify-content:space-between;align-items:center;gap:10px;position:sticky;top:-16px;background:#18382d;z-index:2;padding:6px 0}.frame-options h2{font:600 20px/24px Arial;margin:0;color:inherit}
.frame-options-button[hidden]{display:none}
.frame-options button,.frame-options select{min-height:44px;min-width:44px;font:14px/20px Arial;padding:6px;background:#284c3c;color:#eff9df;border:1px solid #b6ceb1;border-radius:6px}.frame-options>label{display:grid;gap:5px;margin:12px 0;font:14px/20px Arial}.frame-options .icon-button{width:100%;height:44px;border-radius:6px;margin:8px 0}.frame-options .speed-control{display:grid}.frame-options-button{height:44px;min-height:44px;min-width:44px;background:#284c3c;color:#eff9df;border:1px solid #b6ceb1;border-radius:6px;font-size:23px}
`;
