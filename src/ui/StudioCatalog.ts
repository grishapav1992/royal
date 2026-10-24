import { t as translateText, tr } from '../i18n/index';
import { ACTIVE_STUDIO_GAMES } from '../shared/arcadeCatalog';
import { STUDIO_INFO, type StudioKind } from '../shared/studioGames';
import type { StudioGameId } from '../shared/studioGames';
import { STUDIO_ART, studioEscape as escape } from './StudioArtwork';
import './studio-catalog.css';
import { CATALOG_PREVIEWS } from '../game/cabinetArtwork';

const artwork: Readonly<Record<string, string>> = CATALOG_PREVIEWS;
const descriptions: Record<string, string> = {
  'studio-neopolis':translateText('40 линий · Три героя · Битва с Нулём'),
  'studio-dracona':'Каскады · Исчезающий шкаф · Три герба',
  'studio-meme-overload':translateText('Каскады · Разгон ×5 · Вирусный режим'),
  'studio-afterglow':translateText('14 линий · Фотосессия · Альбом героинь'),
  'studio-nitro-run':translateText('20 линий · Передачи · Нитро-рывок'),
  'studio-cosmic-escape': translateText('20 линий · Три космические миссии'),
  'studio-caramel-carnival': translateText('Каскады · Билеты · Энергия до ×50'),
  'studio-velvet-reign': translateText('14 линий · Пять звёзд · Два бонуса'),
  'studio-last-convoy': translateText('Каскады · Баррикады · Эвакуация'),
};

const names: Partial<Record<StudioGameId, string>> = {
  'studio-cosmic-escape': 'Cosmic Escape', 'studio-caramel-carnival': 'Caramel Carnival',
  'studio-velvet-reign': 'Velvet Reign',
};
export const studioCatalogName = (id: StudioGameId) => names[id] ?? STUDIO_INFO[id].name;
const kinds: Record<StudioKind, string> = {
  slot: translateText('Слоты'), crash: translateText('Крэш'), flight: translateText('Полёт'),
  keno: translateText('Кено'), plinko: translateText('Плинко'), dice: translateText('Кости'),
  wheel: translateText('Колесо'), mines: translateText('Мины'),
};

/** Game availability is independent of the number of physical cabinets. */
export class StudioCatalog {
  constructor(private host: HTMLElement, private select: (game: StudioGameId) => void, private visitNewZone?: () => void, selected?: StudioGameId) {
    const games = ACTIVE_STUDIO_GAMES.map(id => STUDIO_INFO[id]);
    this.host.innerHTML = tr`<section class="studio-catalog" aria-label="Новые игры"><div class="studio-catalog-heading"><div><span>ВСЯ КОЛЛЕКЦИЯ В КАЖДОМ АВТОМАТЕ</span><h3>Новые игры</h3></div><strong>${games.length}<small>игр</small></strong></div><p>Выбери игру. Общий кошелёк и сохранённые раунды доступны в любом автомате.</p><div class="studio-catalog-tools"><label class="studio-catalog-field"><span>Найти игру</span><input type="search" aria-label="Найти игру" placeholder="Найти игру"></label><label class="studio-catalog-field"><span>Жанр</span><select aria-label="Жанр"><option value="all">Все жанры</option>${Object.entries(kinds).map(([id, name]) => `<option value="${id}">${escape(name)}</option>`).join('')}</select></label></div><div class="studio-catalog-grid">${games.map(game => tr`<button type="button" class="studio-catalog-card" data-studio="${game.id}" aria-label="Играть: ${escape(studioCatalogName(game.id))}" ${game.id === selected ? 'aria-current="true"' : ''} style="--studio-card-accent:#${game.color.toString(16).padStart(6, '0')}"><span class="studio-catalog-art"><img src="${artwork[game.id] ?? STUDIO_ART[game.theme]}" alt="" loading="lazy" decoding="async"><span class="studio-catalog-kind">${escape(kinds[game.kind])}</span><span class="studio-catalog-mode">${escape(descriptions[game.id] ?? game.subtitle)}</span></span><span class="studio-catalog-copy"><strong>${escape(studioCatalogName(game.id))}</strong><small>${escape(game.subtitle)}</small></span><span class="studio-catalog-arrow" aria-hidden="true">↗</span></button>`).join('')}</div><p data-studio-empty role="status" hidden>Игры не найдены. Измени поиск или жанр.</p>${this.visitNewZone ? translateText('<button type="button" class="luelon-new-visit" data-luelon-zone>Показать автоматы в зале <span aria-hidden="true">→</span></button>') : ''}<div class="studio-catalog-footer"><span>Общий кошелёк клуба</span><span>Тестовые монеты</span></div></section>`;
    const search = this.host.querySelector<HTMLInputElement>('input')!;
    const genre = this.host.querySelector<HTMLSelectElement>('select')!;
    const buttons = this.host.querySelectorAll<HTMLButtonElement>('[data-studio]');
    const filter = () => {
      const query = search.value.trim().toLocaleLowerCase();
      let visible = 0;
      buttons.forEach(button => {
        const game = STUDIO_INFO[button.dataset.studio as StudioGameId];
        const matches = `${studioCatalogName(game.id)} ${game.name} ${game.sourceReferenceId}`.toLocaleLowerCase().includes(query)
          && (genre.value === 'all' || game.kind === genre.value);
        button.hidden = !matches;
        if (matches) visible++;
      });
      this.host.querySelector<HTMLElement>('[data-studio-empty]')!.hidden = visible > 0;
    };
    search.oninput = filter;
    genre.onchange = filter;
    buttons.forEach(button => { button.onclick = () => this.select(button.dataset.studio as StudioGameId); });
    this.host.querySelector<HTMLButtonElement>('[data-luelon-zone]')?.addEventListener('click', () => this.visitNewZone?.());
  }

  destroy() { this.host.replaceChildren(); }
}
