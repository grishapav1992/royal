type Panel = 'rules' | 'history' | 'settings' | 'variants';
const labels: Record<Panel, string> = { rules: 'Правила игры', history: 'История игры', settings: 'Настройки игры', variants: 'Варианты игры' };
const icons: Record<Panel, string> = {
  rules: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  settings: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
  variants: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
};
const secondary: Record<Exclude<Panel, 'variants'>, string> = {
  rules: 'details,.original-subtitle,.original-demo-note,.original-paytable,.github-footer,.ez-fruits-paytable,.ez-fruits-rules,.ez-fruits-footer,.batch-note,.next-board-note,.studio-stage-subtitle',
  history: '.original-history-wrap,.github-history,.studio-steps,.studio-win-list,.slot-history,.slot-line-list,.slot-award-list,.neon-history,.neon-line-list,.cascade-history,.cascade-group-list,.cluster-history,.cluster-group-list,.element-history,.element-line-list,.journey-history,.journey-line-list,.ways-history,.ways-award-list,.ways-award-detail,.collect-history,.collect-award-list,.collect-award-detail,.hold-history,.hold-award-list,.hold-award-detail',
  settings: '.studio-options,.slot-tools,.neon-tools,.cascade-tools,.cluster-tools,.element-tools,.journey-tools,.ways-tools,.collect-tools,.hold-tools,#ez-fruits-wallet,.casino-controls label:has([data-asset])'
};
const tableConsole = '.github-header,.github-controls,.github-result,.casino-controls,.casino-actions,.casino-directions,.casino-status,.casino-error,.expansion-toolbar,.expansion-actions,.expansion-message,.expansion-error,.casino-expansion > p[role="status"],.next-heading,.next-status,.next-controls,.next-actions,.next-error,.batch-heading,.batch-status,.batch-controls,.batch-actions,.batch-error';

/** Keeps the actual controls inside their renderer so actions and saved rounds keep their owners. */
export class GameWindow {
  private stage: HTMLElement;
  private host: HTMLElement;
  private panel: Panel | '' = '';
  private tools = new Map<Panel, HTMLButtonElement>();
  private observer: MutationObserver;
  private attributes: MutationObserver;
  private queued = false;
  private previousGame = '';
  constructor(private dialog: HTMLDialogElement) {
    dialog.classList.add('game-window');
    this.stage = dialog.querySelector('.mini-stage')!;
    this.host = dialog.querySelector('#mini-game')!;
    const tools = document.createElement('nav'); tools.className = 'game-window-tools'; tools.setAttribute('aria-label', 'Меню игры');
    for (const kind of ['variants', 'rules', 'history', 'settings'] as Panel[]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'game-window-tool';
      button.dataset.windowTool = kind; button.title = labels[kind]; button.setAttribute('aria-label', labels[kind]); button.setAttribute('aria-expanded', 'false');
      button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind]}</svg>`;
      button.addEventListener('click', () => this.setPanel(this.panel === kind ? '' : kind));
      this.tools.set(kind, button); tools.append(button);
    }
    dialog.querySelector('.mini-top > [data-close]')!.before(tools);
    const backdrop = document.createElement('button'); backdrop.type = 'button'; backdrop.className = 'game-window-panel-backdrop';
    backdrop.setAttribute('aria-label', 'Закрыть панель'); backdrop.tabIndex = -1; backdrop.addEventListener('click', () => this.setPanel('')); this.stage.append(backdrop);
    dialog.addEventListener('cancel', event => { if (this.panel) { event.preventDefault(); this.setPanel(''); } });
    dialog.addEventListener('close', () => { this.panel = ''; delete dialog.dataset.windowPanel; this.syncButtons(); this.applyInert(); });
    this.observer = new MutationObserver(records => { if (this.needsRefresh(records)) this.schedule(); }); this.observe();
    this.attributes = new MutationObserver(() => this.schedule()); this.attributes.observe(dialog, { attributes: true, attributeFilter: ['open', 'class', 'data-game'] });
    this.refresh();
  }
  private schedule() {
    if (this.queued) return; this.queued = true;
    queueMicrotask(() => { this.queued = false; this.refresh(); });
  }
  private observe() { this.observer.observe(this.stage, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }); }
  private needsRefresh(records: MutationRecord[]) {
    const root = this.rendererRoot(), sections = Object.values(secondary).join(',') + ',.casino-mode-picker';
    return records.some(record => {
      if (record.type === 'attributes') return record.target instanceof Element && record.target.matches('[data-retry],.casino-mode-picker');
      if (record.target === this.host || record.target === this.stage || record.target === root) return true;
      if (record.target instanceof Element && record.target.matches('.casino-mode-picker')) return true;
      return [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(node => node instanceof Element && (node.matches(sections) || !!node.querySelector(sections)));
    });
  }
  private rendererRoot() {
    const first = Array.from(this.host.children).find(element => !element.classList.contains('game-window-sheet'));
    return first instanceof HTMLElement && !(first instanceof HTMLCanvasElement) && !(first instanceof HTMLIFrameElement) ? first : this.host;
  }
  private sheet(root: HTMLElement, kind: Panel) {
    let sheet = Array.from(root.children).find(el => (el as HTMLElement).dataset.windowSheet === kind) as HTMLElement | undefined;
    if (sheet) return sheet;
    sheet = document.createElement('section'); sheet.className = 'game-window-sheet'; sheet.dataset.windowSheet = kind; sheet.setAttribute('aria-label', labels[kind]);
    const heading = document.createElement('header'); heading.className = 'game-window-sheet-heading';
    const title = document.createElement('h3'); title.textContent = labels[kind];
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.className = 'game-window-sheet-close'; close.setAttribute('aria-label', 'Вернуться к игре'); close.addEventListener('click', () => this.setPanel(''));
    heading.append(title, close); const content = document.createElement('div'); content.className = 'game-window-sheet-content'; sheet.append(heading, content); root.append(sheet);
    if (kind === 'settings') {
      const audio = document.createElement('button'); audio.type = 'button'; audio.className = 'game-window-audio'; audio.textContent = 'Звук и музыка';
      audio.addEventListener('click', () => this.dialog.querySelector<HTMLButtonElement>('.mini-bottom .settings-shortcut')?.click()); content.append(audio);
    }
    return sheet;
  }
  private move(root: HTMLElement, node: HTMLElement, kind: Panel) {
    if (node.closest('.game-window-sheet')) return;
    node.dataset.windowSection = kind;
    if (node instanceof HTMLDetailsElement) node.open = true;
    this.sheet(root, kind).querySelector('.game-window-sheet-content')!.append(node);
  }
  private originalSettings(root: HTMLElement) {
    for (const id of ['original-risk', 'original-rows', 'original-dice-mode', 'original-dice-target', 'original-limbo-target', 'original-mine-count']) {
      const control = root.querySelector<HTMLElement>('#' + id);
      if (!control || control.closest('.game-window-sheet')) continue;
      const group = document.createElement('div'); group.className = 'game-window-setting';
      const label = root.querySelector<HTMLLabelElement>(`label[for="${id}"]`); if (label) group.append(label);
      group.append(control.closest('.original-input-suffix') ?? control); this.move(root, group, 'settings');
    }
  }
  private arrangeTableConsole(root: HTMLElement) {
    if (!this.dialog.classList.contains('card-table-mode')) return;
    const controls = Array.from(root.querySelectorAll<HTMLElement>(tableConsole))
      .filter(node => !node.closest('.game-window-sheet,.card-table-console'));
    if (!controls.length) return;
    let console = root.querySelector<HTMLElement>(':scope > .card-table-console');
    if (!console) {
      console = document.createElement('div'); console.className = 'card-table-console';
      console.setAttribute('role', 'group'); console.setAttribute('aria-label', 'Управление столом'); root.append(console);
    }
    for (const control of controls) console.append(control);
  }
  private refresh() {
    this.observer.disconnect();
    try {
      const game = this.dialog.dataset.game ?? '';
      const changedMode = game !== this.previousGame && !!document.activeElement?.closest('.casino-mode-picker');
      if (game !== this.previousGame) { this.previousGame = game; this.panel = ''; delete this.dialog.dataset.windowPanel; }
      this.dialog.dataset.windowKind = this.dialog.classList.contains('card-table-mode') ? 'table' : 'machine';
      if (!this.dialog.open) { this.syncButtons(); return; }
      const root = this.rendererRoot();
      if (root) {
        const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
        for (const retry of Array.from(root.querySelectorAll<HTMLElement>('[data-retry]:not([hidden])'))) {
          if (!retry.closest('.game-window-sheet')) continue;
          let recovery = root.querySelector<HTMLElement>('.game-window-recovery');
          if (!recovery) { recovery = document.createElement('div'); recovery.className = 'game-window-recovery'; root.append(recovery); }
          recovery.append(retry);
        }
        this.originalSettings(root);
        for (const kind of ['rules', 'history', 'settings'] as const) {
          for (const node of Array.from(root.querySelectorAll<HTMLElement>(secondary[kind]))) {
            if (node.querySelector('[data-retry]:not([hidden])')) continue;
            this.move(root, node, kind);
          }
        }
        const description = root.querySelector<HTMLElement>('.variant-heading p,.next-heading p,.batch-heading p,.studio-heading p,.slot-heading p,.neon-heading p,.cascade-heading p,.cluster-heading p,.element-heading p,.journey-heading p,.ways-heading p,.collect-heading p,.hold-heading p,.original-subtitle');
        if (description?.textContent?.trim() && !description.closest('.game-window-sheet') && !root.querySelector('.game-window-description')) {
          const copy = document.createElement('p'); copy.className = 'game-window-description'; copy.textContent = description.textContent;
          this.sheet(root, 'rules').querySelector('.game-window-sheet-content')!.prepend(copy);
        }
        this.sheet(root, 'settings');
        this.arrangeTableConsole(root);
        if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
      }
      const modes = this.dialog.querySelector<HTMLElement>('.casino-mode-picker');
      if (modes && !modes.closest('.game-window-sheet')) this.sheet(this.stage, 'variants').querySelector('.game-window-sheet-content')!.append(modes);
      this.syncButtons();
      this.applyInert();
      if (changedMode) this.tools.get('variants')?.focus({ preventScroll: true });
      this.dialog.scrollTop = 0; this.host.scrollTop = 0;
    } finally { this.observe(); }
  }
  private syncButtons() {
    for (const [kind, button] of this.tools) {
      const sheets = Array.from(this.dialog.querySelectorAll<HTMLElement>(`[data-window-sheet="${kind}"]`));
      button.hidden = !sheets.some(sheet => Array.from(sheet.querySelector('.game-window-sheet-content')?.children ?? []).some(child => !((child as HTMLElement).hidden)));
      button.setAttribute('aria-expanded', String(this.panel === kind));
    }
  }
  private setPanel(kind: Panel | '') {
    const previous = this.panel; this.panel = kind;
    if (kind) this.dialog.dataset.windowPanel = kind; else delete this.dialog.dataset.windowPanel;
    this.syncButtons();
    this.applyInert();
    if (kind) this.dialog.querySelector<HTMLButtonElement>(`[data-window-sheet="${kind}"] .game-window-sheet-close`)?.focus({ preventScroll: true });
    else if (previous) this.tools.get(previous)?.focus({ preventScroll: true });
  }
  private applyInert() {
    const root = this.rendererRoot();
    for (const child of Array.from(root.children)) {
      if (child instanceof HTMLElement) child.inert = !!this.panel && child.dataset.windowSheet !== this.panel;
    }
  }
}
