import { t as translateText } from '../i18n/index';
import './game-viewport.css';
import './slot-layout.css';

const MIN_DESIGN_WIDTH = 800;
const MAX_DESIGN_WIDTH = 1120;

/** Fits presentation only. Game sessions, actions and canvas resolution stay owned by their games. */
export class GameViewport {
  private readonly stage: HTMLElement;
  private readonly plane = document.createElement('div');
  private readonly portrait = window.matchMedia('(max-width: 640px) and (orientation: portrait)');
  private readonly sizes: ResizeObserver;
  private readonly dialogChanges: MutationObserver;
  private readonly contentChanges: MutationObserver;
  private frame = 0;
  private disposed = false;
  private envelopeKey = '';
  private envelopeHeight = 0;
  private widthKey = '';
  private designWidth = 0;
  private readableFlowKey = '';
  private readonly structureChanged = () => {
    this.widthKey = '';
    this.envelopeKey = '';
    this.readableFlowKey = '';
    this.schedule();
  };
  private readonly schedule = () => {
    if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.fit();
    });
  };

  constructor(private readonly dialog: HTMLDialogElement) {
    const stage = dialog.querySelector<HTMLElement>('.mini-stage');
    if (!stage) throw new Error(translateText('Не найдена область игры.'));
    this.stage = stage;
    this.plane.className = 'game-viewport-plane';
    while (stage.firstChild) this.plane.append(stage.firstChild);
    stage.append(this.plane);

    this.sizes = new ResizeObserver(this.schedule);
    this.sizes.observe(stage);
    this.sizes.observe(this.plane);
    this.dialogChanges = new MutationObserver(this.schedule);
    this.dialogChanges.observe(dialog, { attributes: true, attributeFilter: ['open', 'class', 'data-game'] });
    this.contentChanges = new MutationObserver(this.schedule);
    for (const content of Array.from(this.plane.querySelectorAll('#mini-game, #card-dealer-stage'))) {
      this.contentChanges.observe(content, { childList: true });
    }
    this.plane.addEventListener('load', this.schedule, true);
    this.plane.addEventListener('error', this.schedule, true);
    this.plane.addEventListener('toggle', this.structureChanged, true);
    this.portrait.addEventListener('change', this.schedule);
    window.addEventListener('resize', this.schedule);
    window.visualViewport?.addEventListener('resize', this.schedule);
    window.visualViewport?.addEventListener('scroll', this.schedule);
    void document.fonts?.ready.then(this.schedule);
    this.schedule();
  }

  private mode(value: 'fit' | 'layout' | 'flow' | 'off') {
    if (this.dialog.dataset.gameViewport !== value) this.dialog.dataset.gameViewport = value;
  }

  private ready(value: 'fit' | 'layout' | 'flow' | 'off') {
    this.dialog.dataset.gameViewportReady = `${this.dialog.dataset.game ?? ''}|${this.stage.clientWidth}x${this.stage.clientHeight}|${value}`;
  }

  private reset(value: 'flow' | 'off') {
    this.mode(value);
    if (value === 'off') this.readableFlowKey = '';
    this.dialog.style.removeProperty('--slot-layout-height');
    this.plane.style.removeProperty('width');
    this.plane.style.removeProperty('transform');
    for (const name of ['scale', 'natural-width', 'natural-height', 'available-width', 'available-height']) {
      this.dialog.style.removeProperty(`--game-viewport-${name}`);
    }
    this.envelopeKey = '';
    this.envelopeHeight = 0;
    this.widthKey = '';
    this.designWidth = 0;
    this.ready(value);
  }

  private measure(width: number) {
    const value = `${width}px`;
    if (this.plane.style.width !== value) this.plane.style.width = value;
    return Math.max(1, this.plane.offsetHeight, this.plane.scrollHeight);
  }

  private chooseWidth(key: string, preferred: number, height: number) {
    if (this.widthKey === key) return this.designWidth;
    this.widthKey = key;
    this.designWidth = preferred;
    if (this.measure(preferred) <= height || preferred === MIN_DESIGN_WIDTH) return preferred;
    this.designWidth = MIN_DESIGN_WIDTH;
    if (this.measure(MIN_DESIGN_WIDTH) > height) return MIN_DESIGN_WIDTH;
    let low = MIN_DESIGN_WIDTH, high = preferred;
    while (high - low > 2) {
      const middle = Math.floor((low + high) / 2);
      if (this.measure(middle) <= height) low = middle;
      else high = middle;
    }
    this.designWidth = low;
    return low;
  }

  private fit() {
    if (this.disposed) return;
    // Embedded games and Phaser own their own real viewport and pointer mapping.
    if (!this.dialog.open || !this.dialog.classList.contains('originals-mode') || this.dialog.classList.contains('demo-mode')) {
      this.reset('off');
      return;
    }
    if (this.dialog.dataset.game === 'studio-catalog' || this.dialog.dataset.game === 'royal-catalog') {
      this.reset('flow');
      return;
    }
    if (this.dialog.dataset.game === 'casinoapipro') {
      this.reset('off');
      return;
    }
    const nativeSlot = this.plane.querySelector('#mini-game > .cc-game, #mini-game > .ce-game');
    if (nativeSlot && this.stage.clientWidth >= 740 && this.stage.clientHeight >= 580) {
      this.mode('layout');
      this.plane.style.removeProperty('width');
      this.plane.style.removeProperty('transform');
      this.dialog.style.setProperty('--slot-layout-height', `${this.stage.clientHeight}px`);
      this.dialog.style.setProperty('--game-viewport-scale', '1');
      this.envelopeKey = this.widthKey = '';
      this.ready('layout');
      return;
    }
    if (nativeSlot) {
      this.reset('flow');
      return;
    }
    if (this.portrait.matches) {
      this.reset('flow');
      return;
    }

    const content = this.plane.querySelector('#mini-game');
    const signature = Array.from(content?.children ?? []).map(element => `${element.tagName}.${element.className}`).join(':');
    // Outer dimensions stay stable when flow introduces a vertical scrollbar.
    const flowKey = `${this.dialog.dataset.game ?? ''}:${this.stage.offsetWidth}:${this.stage.offsetHeight}:${signature}`;
    if (this.readableFlowKey === flowKey) {
      this.reset('flow');
      return;
    }
    this.mode('fit');
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    if (width < 1 || height < 1) return;
    const viewportKey = `${this.dialog.dataset.game ?? ''}:${width}:${height}:${signature}`;
    const preferred = Math.min(MAX_DESIGN_WIDTH, Math.max(MIN_DESIGN_WIDTH, width));
    const designWidth = this.chooseWidth(viewportKey, preferred, height);
    const naturalHeight = this.measure(designWidth);
    const naturalWidth = Math.max(designWidth, this.plane.scrollWidth);
    const key = `${viewportKey}:${designWidth}`;
    if (key !== this.envelopeKey) {
      this.envelopeKey = key;
      this.envelopeHeight = naturalHeight;
    } else {
      // Short status or wallet updates must not enlarge the entire scene after a spin.
      this.envelopeHeight = Math.max(this.envelopeHeight, naturalHeight);
    }
    const scale = Math.min(1, width / naturalWidth, height / this.envelopeHeight);
    if (scale < .9) {
      this.readableFlowKey = flowKey;
      this.reset('flow');
      return;
    }
    const left = Math.max(0, (width - naturalWidth * scale) / 2);
    const top = Math.max(0, (height - this.envelopeHeight * scale) / 2);
    const transform = `translate(${left}px, ${top}px) scale(${scale})`;
    if (this.plane.style.transform !== transform) this.plane.style.transform = transform;
    for (const [name, value] of Object.entries({
      scale, 'natural-width': naturalWidth, 'natural-height': this.envelopeHeight,
      'available-width': width, 'available-height': height,
    })) {
      const property = `--game-viewport-${name}`;
      if (this.dialog.style.getPropertyValue(property) !== String(value)) this.dialog.style.setProperty(property, String(value));
    }
    this.ready('fit');
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.sizes.disconnect();
    this.dialogChanges.disconnect();
    this.contentChanges.disconnect();
    this.plane.removeEventListener('load', this.schedule, true);
    this.plane.removeEventListener('error', this.schedule, true);
    this.plane.removeEventListener('toggle', this.structureChanged, true);
    this.portrait.removeEventListener('change', this.schedule);
    window.removeEventListener('resize', this.schedule);
    window.visualViewport?.removeEventListener('resize', this.schedule);
    window.visualViewport?.removeEventListener('scroll', this.schedule);
    this.reset('off');
    delete this.dialog.dataset.gameViewport;
    delete this.dialog.dataset.gameViewportReady;
    while (this.plane.firstChild) this.stage.insertBefore(this.plane.firstChild, this.plane);
    this.plane.remove();
  }
}
