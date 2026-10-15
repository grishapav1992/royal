import { APPEARANCE_OPTIONS, CLOTHING_COLORS, HAIR_COLORS, MAKEUP_COLORS, SKIN_COLORS, appearanceFromLegacy, randomAppearance, type Appearance, type AppearanceField } from '../shared/appearance';
import { drawAvatar } from '../game/avatarArt';
import type { Facing } from '../shared/movement';
import './character-editor.css';

const groups: { label: string; fields: [AppearanceField, string][] }[] = [
  { label: 'Основа', fields: [['gender', 'Пол'], ['body', 'Телосложение'], ['skinTone', 'Оттенок кожи']] },
  { label: 'Лицо', fields: [['eyes', 'Глаза'], ['eyebrows', 'Брови'], ['mouth', 'Рот'], ['makeup', 'Макияж'], ['makeupColor', 'Цвет макияжа'], ['facialHair', 'Борода и усы']] },
  { label: 'Волосы', fields: [['hair', 'Причёска'], ['hairColor', 'Цвет волос']] },
  { label: 'Одежда', fields: [['top', 'Верх'], ['topColor', 'Цвет верха'], ['bottom', 'Низ'], ['bottomColor', 'Цвет низа'], ['shoes', 'Обувь'], ['shoeColor', 'Цвет обуви']] },
  { label: 'Аксессуары', fields: [['hat', 'Головной убор'], ['accessoryColor', 'Цвет аксессуаров'], ['glasses', 'Очки'], ['earrings', 'Серьги'], ['necklace', 'На шею'], ['scarf', 'Шарф']] },
  { label: 'Тату', fields: [['tattoo', 'Глупые татуировки']] },
];
const swatches: Partial<Record<AppearanceField, string[]>> = { skinTone: SKIN_COLORS, hairColor: HAIR_COLORS, topColor: CLOTHING_COLORS, bottomColor: CLOTHING_COLORS, shoeColor: CLOTHING_COLORS, accessoryColor: CLOTHING_COLORS, makeupColor: MAKEUP_COLORS };
const directions: [Facing, string][] = [['down', 'Спереди'], ['left', 'Слева'], ['up', 'Сзади'], ['right', 'Справа']];
type ViewBox = [x: number, y: number, width: number, height: number];
const fullView: ViewBox = [-6, -14, 44, 55];
const detailView: ViewBox = [-2, -13, 36, 45];
const thumbnailViews: Partial<Record<AppearanceField, ViewBox>> = {
  body: fullView,
  hair: [-1, -7, 34, 39], hat: [-1, -14, 34, 43],
  eyes: [5, 5, 22, 16], eyebrows: [5, 4, 22, 16], mouth: [6, 9, 20, 15],
  makeup: [4, 3, 24, 22], facialHair: [4, 6, 24, 21],
  top: [0, 15, 32, 23], bottom: [0, 27, 32, 15], shoes: [1, 31, 30, 11],
  glasses: [3, 4, 26, 20], earrings: [1, 3, 30, 23], necklace: [3, 17, 26, 18], scarf: [2, 16, 28, 20],
};

export class CharacterEditor {
  readonly element = document.createElement('div');
  private current = appearanceFromLegacy(null);
  private canvas = document.createElement('canvas');
  private facing: Facing = 'down';
  private pose: 'idle' | 'walk' | 'sit' | 'drink' | 'game' | 'win' | 'lose' = 'idle';
  private closeUp = false;
  private activeTab = 0;
  private buttons = new Map<AppearanceField, HTMLButtonElement[]>();
  private thumbnails = new Map<AppearanceField, HTMLCanvasElement[]>();
  private selectedLabels = new Map<AppearanceField, HTMLElement>();
  private panels: HTMLElement[] = [];
  private tabs: HTMLButtonElement[] = [];
  private hints: HTMLElement[] = [];
  private motion?: ReturnType<typeof setInterval>;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private locked = false;

  constructor(id: string) {
    this.element.className = 'character-editor';
    this.element.dataset.editor = id;
    const preview = document.createElement('div');
    preview.className = 'character-preview';
    const badge = document.createElement('span');
    badge.className = 'wardrobe-badge';
    badge.textContent = 'ТВОЙ ОБРАЗ';
    this.canvas.width = 640;
    this.canvas.height = 800;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Предпросмотр персонажа');
    const stage = document.createElement('div');
    stage.className = 'character-stage';
    stage.append(this.canvas);
    const zoom = document.createElement('div');
    zoom.className = 'preview-zoom';
    zoom.setAttribute('role', 'group');
    zoom.setAttribute('aria-label', 'Масштаб предпросмотра');
    for (const [closeUp, label] of [[false, 'Весь образ'], [true, 'Крупнее']] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('aria-pressed', String(closeUp === this.closeUp));
      button.addEventListener('click', () => {
        this.closeUp = closeUp;
        stage.classList.toggle('is-close-up', closeUp);
        zoom.querySelectorAll('button').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
        this.draw();
      });
      zoom.append(button);
    }
    const turns = document.createElement('div');
    turns.className = 'preview-directions';
    turns.setAttribute('role', 'group');
    turns.setAttribute('aria-label', 'Поворот персонажа');
    directions.forEach(([facing, name]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.setAttribute('aria-pressed', String(facing === this.facing));
      button.addEventListener('click', () => {
        this.facing = facing;
        turns.querySelectorAll('button').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
        this.draw();
      });
      turns.append(button);
    });
    const poses = document.createElement('select');
    poses.className = 'preview-pose';
    poses.setAttribute('aria-label', 'Поза персонажа');
    for (const [value, label] of [['idle', 'Стоит'], ['walk', 'Идёт'], ['sit', 'Сидит'], ['drink', 'Пьёт'], ['game', 'За автоматом'], ['win', 'Радуется'], ['lose', 'Огорчён']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      poses.append(option);
    }
    poses.addEventListener('change', () => { this.pose = poses.value as typeof this.pose; this.draw(); });
    const random = document.createElement('button');
    random.className = 'wardrobe-random';
    random.type = 'button';
    random.textContent = 'Случайный образ';
    random.addEventListener('click', () => { this.current = randomAppearance(); this.render(); });
    const free = document.createElement('small');
    free.className = 'wardrobe-free';
    free.textContent = 'Все вещи бесплатные. Сочетай как хочешь.';
    preview.append(badge, stage, zoom, turns, poses, random, free);

    const controls = document.createElement('div');
    controls.className = 'wardrobe-controls';
    const tablist = document.createElement('div');
    tablist.className = 'wardrobe-tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Категории внешности');
    const chooseTab = (index: number) => {
      this.activeTab = index;
      this.tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
      this.panels.forEach((panel, i) => { panel.hidden = i !== index; });
      this.drawThumbnails();
    };
    groups.forEach((group, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.textContent = group.label;
      tab.id = `${id}-tab-${index}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `${id}-panel-${index}`);
      tab.setAttribute('aria-selected', String(index === 0));
      tab.tabIndex = index === 0 ? 0 : -1;
      tab.addEventListener('click', () => chooseTab(index));
      tab.addEventListener('keydown', event => {
        const key = event.key;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        event.preventDefault();
        const next = key === 'Home' ? 0 : key === 'End' ? groups.length - 1 : (index + (key === 'ArrowRight' ? 1 : groups.length - 1)) % groups.length;
        chooseTab(next);
        this.tabs[next].focus();
      });
      const panel = document.createElement('div');
      panel.className = 'wardrobe-panel';
      panel.id = `${id}-panel-${index}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.hidden = index !== 0;
      group.fields.forEach(([field, title]) => {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'wardrobe-field';
        fieldset.dataset.field = field;
        const legend = document.createElement('legend');
        const fieldName = document.createElement('span');
        fieldName.textContent = title;
        const selected = document.createElement('span');
        selected.className = 'wardrobe-selected-label';
        this.selectedLabels.set(field, selected);
        legend.append(fieldName, selected);
        fieldset.append(legend);
        const choices = document.createElement('div');
        choices.className = swatches[field] ? 'wardrobe-swatches' : field === 'gender' ? 'wardrobe-text-choices' : 'wardrobe-choices';
        const thumbnails: HTMLCanvasElement[] = [];
        this.buttons.set(field, APPEARANCE_OPTIONS[field].map((label, value) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.value = String(value);
          button.setAttribute('aria-label', `${title}: ${label}`);
          button.title = label;
          button.setAttribute('aria-pressed', String(this.current[field] === value));
          if (swatches[field]) {
            button.className = 'wardrobe-swatch';
            button.style.setProperty('--swatch', swatches[field]![value]);
          } else if (field === 'gender') button.textContent = label;
          else {
            button.className = 'wardrobe-choice';
            const thumbnail = document.createElement('canvas');
            thumbnail.width = 168;
            thumbnail.height = 144;
            thumbnail.setAttribute('aria-hidden', 'true');
            thumbnails.push(thumbnail);
            const name = document.createElement('span');
            name.className = 'wardrobe-choice-label';
            name.textContent = label;
            button.append(thumbnail, name);
          }
          button.addEventListener('click', () => { this.current[field] = value; this.render(); });
          choices.append(button);
          return button;
        }));
        if (thumbnails.length) this.thumbnails.set(field, thumbnails);
        fieldset.append(choices);
        panel.append(fieldset);
      });
      const hint = document.createElement('p');
      hint.className = 'wardrobe-hint';
      this.hints.push(hint);
      panel.append(hint);
      this.tabs.push(tab);
      this.panels.push(panel);
      tablist.append(tab);
      controls.append(panel);
    });
    controls.prepend(tablist);
    this.element.append(preview, controls);
    this.render();
  }

  get value(): Appearance { return { ...this.current }; }
  set value(value: Appearance) { this.current = { ...value }; this.render(); }

  setBusy(value: boolean) {
    this.locked = value;
    this.element.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(control => control.disabled = value);
  }

  setActive(value: boolean) {
    if (this.motion) clearInterval(this.motion);
    this.motion = undefined;
    if (value && !this.reduced) this.motion = setInterval(() => this.draw(), 83);
    this.draw();
  }

  private render() {
    for (const [field, buttons] of this.buttons) {
      buttons.forEach((button, index) => {
        button.setAttribute('aria-pressed', String(this.current[field] === index));
        button.disabled = this.locked;
      });
      this.selectedLabels.get(field)!.textContent = APPEARANCE_OPTIONS[field][this.current[field]];
    }
    this.updateHints();
    this.drawThumbnails();
    this.draw();
  }

  private paint(canvas: HTMLCanvasElement, appearance: Appearance, view: ViewBox, facing: Facing = 'down', frame = 6, seated = false, sip = -1) {
    canvas.dataset.previewView = JSON.stringify(view);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    const scale = Math.min(canvas.width / view[2], canvas.height / view[3]);
    context.translate((canvas.width - view[2] * scale) / 2, (canvas.height - view[3] * scale) / 2);
    context.scale(scale, scale);
    context.translate(-view[0], -view[1]);
    if (appearance.body === 2) { context.translate(0, 39.5); context.scale(1, 1.12); context.translate(0, -39.5); }
    drawAvatar(context, appearance, facing, frame, seated, sip);
    context.restore();
  }

  private drawThumbnails() {
    for (const [field] of groups[this.activeTab].fields) {
      this.thumbnails.get(field)?.forEach((canvas, value) => {
        const sample = { ...this.current, [field]: value };
        const view = field === 'tattoo' ? value === 3 || value === 4 ? [14, 21, 18, 17] as ViewBox : [4, 5, 24, 21] as ViewBox : thumbnailViews[field] ?? fullView;
        this.paint(canvas, sample, view);
      });
    }
  }

  private updateHints() {
    const a = this.current;
    this.hints[0].textContent = 'Начни с силуэта, затем добавь характер деталями.';
    this.hints[1].textContent = [
      a.glasses === 3 ? 'Солнечные очки закрывают глаза и брови.' : '',
      a.facialHair ? 'Борода и усы могут закрывать рот и помаду.' : '',
    ].filter(Boolean).join(' ') || 'Поверни персонажа, чтобы рассмотреть черты лица.';
    this.hints[2].textContent = a.hat ? 'Головной убор закрывает верх причёски. Сними его, чтобы увидеть волосы целиком.' : 'Карточки показывают причёски на твоём персонаже.';
    this.hints[3].textContent = a.top === 4 ? 'Пальто закрывает верх брюк или юбки.' : 'Карточки показывают вещи вместе с остальным образом.';
    this.hints[4].textContent = a.scarf && a.necklace ? 'Шарф надет поверх украшения на шее.'
      : a.earrings && a.hair !== 7 ? 'Серьги могут быть скрыты волосами. Поверни персонажа, чтобы рассмотреть их.'
        : 'Карточки показывают аксессуары вместе с причёской и одеждой.';
    this.hints[5].textContent = (a.tattoo === 3 || a.tattoo === 4) && a.top !== 0
      ? 'Рукав закрывает татуировку на руке. Выбери футболку, чтобы увидеть рисунок.'
      : 'Тату на руке лучше видно в футболке. Поверни персонажа, чтобы рассмотреть рисунок.';
  }

  private draw() {
    const time = this.reduced ? 0 : Date.now();
    const phase = this.reduced ? 0 : Math.floor(time / 83) % 6;
    const frame = this.pose === 'game' ? 28 + phase : this.pose === 'win' ? 34 + phase : this.pose === 'lose' ? 40 + phase
      : this.pose === 'walk' ? phase : this.pose === 'idle' ? Math.floor(time / 1600) % 4 + 6 : 6;
    const view = this.closeUp ? detailView : fullView;
    this.paint(this.canvas, this.current, view, this.facing, frame, this.pose === 'sit', this.pose === 'drink' ? this.reduced ? 2 : Math.floor(time / 166) % 6 : -1);
  }
}
