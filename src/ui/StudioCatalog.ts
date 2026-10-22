import { t as translateText, tr } from '../i18n/index';
import { ACTIVE_STUDIO_GAMES } from '../shared/arcadeCatalog';
import { CABINETS } from '../shared/cabinets';
import type { StudioGameId } from '../shared/studioGames';
import { studioEscape as escape } from './StudioArtwork';
import './studio-catalog.css';
import { CATALOG_PREVIEWS } from '../game/cabinetArtwork';

const artwork: Readonly<Record<string, string>> = CATALOG_PREVIEWS;
const descriptions: Record<string, string> = {
  'studio-dracona':'Каскады · Исчезающий шкаф · Три герба',
  'studio-meme-overload':translateText('Каскады · Разгон ×5 · Вирусный режим'),
  'studio-afterglow':translateText('14 линий · Фотосессия · Альбом героинь'),
  'studio-nitro-run':translateText('20 линий · Передачи · Нитро-рывок'),
  'studio-cosmic-escape': translateText('20 линий · Три космические миссии'),
  'studio-caramel-carnival': translateText('Каскады · Билеты · Энергия до ×50'),
  'studio-velvet-reign': translateText('14 линий · Пять звёзд · Два бонуса'),
  'studio-last-convoy': translateText('Каскады · Баррикады · Эвакуация'),
};

/** The physical cabinet list also defines which games can appear in the catalogue. */
export class StudioCatalog {
  constructor(private host: HTMLElement, private select: (game: StudioGameId) => void, private visitNewZone?: () => void) {
    const games = ACTIVE_STUDIO_GAMES.flatMap(id => {
      const cabinet = CABINETS.find(item => item.id === id);
      return cabinet ? [cabinet] : [];
    });
    this.host.innerHTML = tr`<section class="studio-catalog" aria-label="Новые игры"><div class="studio-catalog-heading"><div><span>РЯДОМ СО ВХОДОМ · ЭТАЖ 1</span><h3>Новые игры</h3></div><strong>${games.length}<small>${games.length===1?translateText('игра'):games.length<5?translateText('игры'):translateText('игр')}</small></strong></div><p>Отдельные миры с бонусами и общим тестовым кошельком. Все автоматы стоят рядом.</p><div class="studio-catalog-grid">${games.map(game => tr`<button type="button" class="studio-catalog-card" data-studio="${game.id}" aria-label="Подойти к ${escape(game.name)}" style="--studio-card-accent:#${game.color.toString(16).padStart(6, '0')}"><span class="studio-catalog-art"><img src="${artwork[game.id]}" alt="" loading="lazy" decoding="async"><span class="studio-catalog-kind">СЛОТ</span><span class="studio-catalog-mode">${escape(descriptions[game.id])}</span></span><span class="studio-catalog-copy"><strong>${escape(game.name)}</strong><small>${escape(game.subtitle)}</small></span><span class="studio-catalog-arrow" aria-hidden="true">↗</span></button>`).join('')}</div>${this.visitNewZone ? translateText('<button type="button" class="luelon-new-visit" data-luelon-zone>Показать новые игры в зале <span aria-hidden="true">→</span></button>') : ''}<div class="studio-catalog-footer"><span>Общий кошелёк клуба</span><span>Тестовые монеты</span></div></section>`;
    this.host.querySelectorAll<HTMLButtonElement>('[data-studio]').forEach(button => {
      button.onclick = () => this.select(button.dataset.studio as StudioGameId);
    });
    this.host.querySelector<HTMLButtonElement>('[data-luelon-zone]')?.addEventListener('click', () => this.visitNewZone?.());
  }

  destroy() { this.host.replaceChildren(); }
}
