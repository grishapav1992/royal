import { createCharacterPortrait } from '../game/characters';
import { PLAYER_CHARACTERS, isPlayerCharacter } from '../shared/characters';
import './character-selector.css';

const portraits = new Map<number, string>();
function portrait(skin: number) {
  if (!portraits.has(skin)) portraits.set(skin, createCharacterPortrait(skin, '', 6).toDataURL());
  return portraits.get(skin)!;
}

export class CharacterSelector {
  readonly element = document.createElement('div');
  private current: number | null = 0;
  private explicit = false;
  private buttons = new Map<number, HTMLButtonElement>();
  private note = document.createElement('p');

  constructor(id: string) {
    this.element.className = 'character-selector';
    this.element.dataset.selector = id;
    const grid = document.createElement('div');
    grid.className = 'character-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Готовые персонажи');
    for (const character of PLAYER_CHARACTERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'character-choice';
      button.dataset.skin = String(character.id);
      button.setAttribute('aria-label', character.name);
      button.title = character.detail;
      const image = document.createElement('img');
      image.src = portrait(character.id);
      image.alt = '';
      image.width = 512;
      image.height = 768;
      image.draggable = false;
      const name = document.createElement('span');
      name.textContent = character.name;
      button.append(image, name);
      button.addEventListener('click', () => {
        this.current = character.id;
        this.explicit = true;
        this.render();
      });
      this.buttons.set(character.id, button);
      grid.append(button);
    }
    this.note.className = 'character-selection-note';
    this.note.setAttribute('role', 'status');
    this.note.setAttribute('aria-live', 'polite');
    this.element.append(grid, this.note);
    this.render();
  }

  get value() { return this.current; }
  set value(skin: number | null) {
    this.current = isPlayerCharacter(skin) ? skin : null;
    this.explicit = false;
    this.render();
  }

  get hasSelection() { return this.explicit; }

  setBusy(busy: boolean) {
    for (const button of this.buttons.values()) button.disabled = busy;
  }

  private render() {
    for (const [skin, button] of this.buttons) button.setAttribute('aria-pressed', String(skin === this.current));
    const selected = PLAYER_CHARACTERS.find(character => character.id === this.current);
    this.note.textContent = selected ? `${selected.name}: ${selected.detail}.`
      : 'Твой текущий персонаж сохранится. Чтобы сменить его, выбери готового.';
  }
}
