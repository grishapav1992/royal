import {ARCHIVED_GITHUB_GAMES} from '../shared/arcadeCatalog';
import { language } from '../i18n/index';
import { FIRST_FLOOR_ART, FIRST_FLOOR_GAME_THEMES } from './FirstFloorGameArt';
import './imported-game-themes.css';
import './first-floor-game-worlds.css';

// Only the games in the archived GitHub collection receive this design.
export const IMPORTED_GAME_THEMES = Object.fromEntries(Object.entries(FIRST_FLOOR_GAME_THEMES).filter(([id])=>(ARCHIVED_GITHUB_GAMES as readonly string[]).includes(id))) as Partial<typeof FIRST_FLOOR_GAME_THEMES>;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const gems: Record<string, readonly [string, string, string]> = {
  '🟡': ['citrine', 'Цитрин', 'Citrine'], '🟢': ['emerald', 'Изумруд', 'Emerald'],
  '🔵': ['sapphire', 'Сапфир', 'Sapphire'], '🟣': ['amethyst', 'Аметист', 'Amethyst'],
  '🟠': ['amber', 'Янтарь', 'Amber'], '💎': ['diamond', 'Алмаз', 'Diamond'],
};

/** Decoration only. No wallet, game state, random outcome, wager or action is read or changed. */
export function decorateImportedGame(root: HTMLElement, gameId: string): void {
  if (!Object.hasOwn(IMPORTED_GAME_THEMES, gameId)) return;
  const themeId = IMPORTED_GAME_THEMES[gameId as keyof typeof IMPORTED_GAME_THEMES];
  if(!themeId)return;
  const previous = root.querySelector<HTMLElement>(':scope > .imported-intro');
  if (previous?.dataset.introGame === gameId && previous.dataset.introLanguage === language) return;
  const theme = FIRST_FLOOR_ART[themeId], index = language === 'en' ? 1 : 0;
  const name = root.getAttribute('aria-label') ?? root.querySelector<HTMLElement>('h3:not(.imported-title)')?.textContent ?? (gameId === 'github-tower' ? 'Dragon Tower' : gameId);
  root.classList.add('imported-game');
  root.dataset.visualTheme = themeId;
  ['accent', 'secondary', 'ground', 'panel', 'muted'].forEach((key, i) => root.style.setProperty(`--ig-${key}`, theme.palette[i]));
  const emblem = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200"><g fill="none" stroke="${theme.palette[0]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${theme.emblem}</g></svg>`;
  root.style.setProperty('--ig-emblem', `url("data:image/svg+xml,${encodeURIComponent(emblem)}")`);
  const intro = document.createElement('header');
  intro.className = 'imported-intro';
  intro.dataset.introGame = gameId;
  intro.dataset.introLanguage = language;
  intro.innerHTML = `<svg class="imported-scene" viewBox="0 0 900 240" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">${theme.scene}</svg><div class="imported-intro-copy"><span class="imported-kicker"><i aria-hidden="true"></i>${escape(name)}</span><h3 class="imported-title">${escape(theme.title[index])}</h3><p>${escape(theme.caption[index])}</p></div><span class="imported-edition" aria-hidden="true">${escape(theme.location[index])}</span>`;
  if (previous) previous.replaceWith(intro); else root.prepend(intro);
  root.querySelectorAll<HTMLElement>('.github-table, .expansion-board, .casino-board, .original-board-wrap, .fruits-frame, .plinko-frame').forEach(board => board.classList.add('imported-playfield'));
  // Colour and cut distinguish only the gem symbols already visible on screen.
  root.querySelectorAll<HTMLElement>('.expansion-gems > span').forEach(gem => {
    const spec = gems[gem.textContent ?? ''];
    gem.dataset.gem = spec?.[0] ?? 'unopened';
    gem.setAttribute('role', 'img');
    gem.setAttribute('aria-label', spec?.[index + 1] ?? (index ? 'Unrevealed gem' : 'Самоцвет ещё не открыт'));
  });
}
