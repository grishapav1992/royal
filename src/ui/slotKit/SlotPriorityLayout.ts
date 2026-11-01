import { gameContentLayout } from '../GameLayoutPolicy';
import { t } from '../../i18n/index';
import './slot-priorities.css';

type Home = { node: HTMLElement; marker: Comment };

/** One owner for slot geometry. Move live controls, retaining their handlers and state. */
export class SlotPriorityLayout {
  private readonly observer: ResizeObserver;
  private readonly hud = document.createElement('div');
  private readonly extras = document.createElement('div');
  private readonly counters: HTMLElement[];
  private readonly secondary: HTMLElement[];
  private readonly pause: HTMLElement | null;
  private readonly controls: HTMLElement | null;
  private moved: Home[] = [];
  private modelHome?: Home;
  private compact = false;

  constructor(private root: HTMLElement, dialog: HTMLDialogElement, footer: HTMLElement, private closePanel: () => void) {
    root.classList.add('slot-priority-game');
    this.hud.className = 'slot-feature-strip'; this.hud.setAttribute('aria-label', t('Состояние раунда'));
    root.append(this.hud);
    this.extras.className = 'slot-secondary-controls'; dialog.insertBefore(this.extras, footer);
    // GIRLHUB's portrait follows the same scene columns as the other six slots.
    const model = root.querySelector<HTMLElement>(':scope>.ag-model'), scene = root.querySelector('.cc-scene');
    if (model && scene) { const marker=document.createComment('slot model');model.before(marker);this.modelHome={node:model,marker};scene.prepend(model); }
    this.counters = Array.from(root.querySelectorAll<HTMLElement>(
      '[data-cc-ticket-count],.cc-series,.cc-factor-card,.nr-nitro-card,.ag-album-progress,.ag-pin-card,'
      + '.ce-portals>strong,.ce-energy,.ce-free-spins,.lg-feature-counters',
    ));
    this.secondary = Array.from(root.querySelectorAll<HTMLElement>(
      '.cc-tickets,.cc-energy,.ce-sidebar,[data-cc-speed],[data-lg-speed],[data-cc-auto-count],[data-lg-auto-count],'
      + '.cc-tools>button:not(.slot-settings-button),.ce-tools>button:not(.slot-settings-button),[data-mo-menu]',
    ));
    this.pause=root.querySelector('[data-cc-pause],[data-lg-pause]');
    this.controls=root.querySelector('.cc-controls,.ce-console');
    for (const node of this.secondary) {
      if (node.matches('select')) node.setAttribute('title',node.getAttribute('aria-label')||t('Число платных автовращений'));
    }
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(root); this.resize();
  }
  private move(node: HTMLElement, target: HTMLElement) {
    const marker=document.createComment('slot priority');node.before(marker);this.moved.push({node,marker});target.append(node);
  }
  private restore() { for (const {node,marker} of this.moved.reverse()) marker.replaceWith(node);this.moved=[];this.extras.replaceChildren(); }
  private resize() {
    const {width,height}=this.root.getBoundingClientRect(),profile=gameContentLayout(width,height),compact=profile!=='full';
    this.root.dataset.slotPriority=profile;
    if (compact===this.compact)return;
    this.compact=compact;
    if (compact) {
      for (const node of this.counters) this.move(node,this.hud);
      for (const node of this.secondary) {
        if (node.matches('select')) { const label=document.createElement('label');label.textContent=node.getAttribute('aria-label');this.extras.append(label);this.move(node,label); }
        else this.move(node,this.extras);
      }
      if(this.pause&&this.controls)this.move(this.pause,this.controls);
    } else { this.restore();this.closePanel(); }
  }
  destroy() {
    this.observer.disconnect();this.restore();this.modelHome?.marker.replaceWith(this.modelHome.node);
    this.hud.remove();this.extras.remove();delete this.root.dataset.slotPriority;this.root.classList.remove('slot-priority-game');
  }
}
