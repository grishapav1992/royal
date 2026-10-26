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

export class CharacterEditor {
  readonly element = document.createElement('div');
  private current = appearanceFromLegacy(null);
  private canvas = document.createElement('canvas');
  private facing: Facing = 'down';
  private pose: 'idle' | 'walk' | 'sit' | 'drink' = 'idle';
  private buttons = new Map<AppearanceField, HTMLButtonElement[]>();
  private panels: HTMLElement[] = [];
  private tabs: HTMLButtonElement[] = [];
  private motion?: ReturnType<typeof setInterval>;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private locked = false;
  constructor(id: string) {
    this.element.className = 'character-editor'; this.element.dataset.editor = id;
    const preview = document.createElement('div'); preview.className = 'character-preview';
    const badge = document.createElement('span'); badge.className = 'wardrobe-badge'; badge.textContent = 'ТВОЙ ОБРАЗ';
    this.canvas.width = 256; this.canvas.height = 320; this.canvas.setAttribute('role', 'img'); this.canvas.setAttribute('aria-label', 'Предпросмотр персонажа');
    const stage = document.createElement('div'); stage.className = 'character-stage'; stage.append(this.canvas);
    const turns = document.createElement('div'); turns.className = 'preview-directions'; turns.setAttribute('role', 'group'); turns.setAttribute('aria-label', 'Поворот персонажа');
    directions.forEach(([facing, name]) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.setAttribute('aria-pressed', String(facing === this.facing));
      button.addEventListener('click', () => { this.facing = facing; turns.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); this.draw(); }); turns.append(button);
    });
    const poses = document.createElement('select'); poses.className = 'preview-pose'; poses.setAttribute('aria-label', 'Поза персонажа');
    for (const [value, label] of [['idle', 'Стоит'], ['walk', 'Идёт'], ['sit', 'Сидит'], ['drink', 'Пьёт']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; poses.append(option); }
    poses.addEventListener('change', () => { this.pose = poses.value as typeof this.pose; this.draw(); });
    const random = document.createElement('button'); random.className = 'wardrobe-random'; random.type = 'button'; random.textContent = 'Случайный образ';
    random.addEventListener('click', () => { this.current = randomAppearance(); this.render(); });
    const free = document.createElement('small'); free.className = 'wardrobe-free'; free.textContent = 'Все вещи бесплатные. Сочетай как хочешь.';
    preview.append(badge, stage, turns, poses, random, free);
    const controls = document.createElement('div'); controls.className = 'wardrobe-controls';
    const tablist = document.createElement('div'); tablist.className = 'wardrobe-tabs'; tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', 'Категории внешности');
    const chooseTab = (index: number) => {
      this.tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
      this.panels.forEach((panel, i) => { panel.hidden = i !== index; });
    };
    groups.forEach((group, index) => {
      const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = group.label; tab.id = `${id}-tab-${index}`;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `${id}-panel-${index}`); tab.setAttribute('aria-selected', String(index === 0)); tab.tabIndex = index === 0 ? 0 : -1;
      tab.addEventListener('click', () => chooseTab(index));
      tab.addEventListener('keydown', event => {
        const key = event.key; if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        event.preventDefault(); const next = key === 'Home' ? 0 : key === 'End' ? groups.length - 1 : (index + (key === 'ArrowRight' ? 1 : groups.length - 1)) % groups.length;
        chooseTab(next); this.tabs[next].focus();
      });
      const panel = document.createElement('div'); panel.className = 'wardrobe-panel'; panel.id = `${id}-panel-${index}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.hidden = index !== 0;
      group.fields.forEach(([field, title]) => {
        const fieldset = document.createElement('fieldset'); fieldset.className = 'wardrobe-field'; fieldset.dataset.field = field;
        const legend = document.createElement('legend'); legend.textContent = title; fieldset.append(legend);
        const choices = document.createElement('div'); choices.className = swatches[field] ? 'wardrobe-swatches' : 'wardrobe-choices';
        this.buttons.set(field, APPEARANCE_OPTIONS[field].map((label, value) => {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.value = String(value); button.setAttribute('aria-label', `${title}: ${label}`);
          button.title = label; button.setAttribute('aria-pressed', String(this.current[field] === value));
          if (swatches[field]) { button.className = 'wardrobe-swatch'; button.style.setProperty('--swatch', swatches[field]![value]); }
          else button.textContent = label;
          button.addEventListener('click', () => { this.current[field] = value; this.render(); }); choices.append(button); return button;
        }));
        fieldset.append(choices); panel.append(fieldset);
      });
      if (group.label === 'Основа') { const hint = document.createElement('p'); hint.className = 'wardrobe-hint'; hint.textContent = 'Для всех одна форма тела. Создай образ причёской, макияжем и аксессуарами.'; panel.append(hint); }
      if (group.label === 'Тату') { const hint = document.createElement('p'); hint.className = 'wardrobe-hint'; hint.textContent = 'Пельмень, НЛО или ошибка 404? Тату на руке лучше видно в футболке.'; panel.append(hint); }
      this.tabs.push(tab); this.panels.push(panel); tablist.append(tab); controls.append(panel);
    });
    controls.prepend(tablist); this.element.append(preview, controls); this.draw();
  }
  get value(): Appearance { return { ...this.current }; }
  set value(value: Appearance) { this.current = { ...value }; this.render(); }
  setBusy(value: boolean) {
    this.locked = value;
    this.element.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(control => control.disabled = value);
  }
  setActive(value: boolean) {
    if (this.motion) clearInterval(this.motion); this.motion = undefined;
    if (value && !this.reduced) this.motion = setInterval(() => this.draw(), 83);
    this.draw();
  }
  private render() {
    this.canvas.style.transform = this.current.body === 2 ? 'scaleY(1.12)' : '';
    this.canvas.style.transformOrigin = 'center bottom';
    for (const [field, buttons] of this.buttons) buttons.forEach((button, index) => { button.setAttribute('aria-pressed', String(this.current[field] === index)); button.disabled = this.locked; });
    this.draw();
  }
  private draw() {
    const context = this.canvas.getContext('2d')!; context.clearRect(0, 0, 256, 320); context.save(); context.scale(8, 8);
    const time = this.reduced ? 0 : Date.now();
    const frame = this.pose === 'walk' ? this.reduced ? 0 : Math.floor(time / 83) % 6 : this.pose === 'idle' ? Math.floor(time / 1600) % 4 + 6 : 6;
    drawAvatar(context, this.current, this.facing, frame, this.pose === 'sit', this.pose === 'drink' ? this.reduced ? 2 : Math.floor(time / 166) % 6 : -1); context.restore();
  }
}
