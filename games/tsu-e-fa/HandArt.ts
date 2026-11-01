import type { TsuEFaChoice } from '../../src/shared/tsuEFa';

const atlas = '/assets/tsu-e-fa/v2/hand-poses.png';
const rows: Record<TsuEFaChoice, number> = { rock: 0, scissors: 1, paper: 2 };

// Two columns (burgundy / blue), four rows. Reuse one cached image for all poses.
function hand(row: number, side: 0 | 1, y: number, active = false) {
  return `<g${active ? ' class="td-active-hand"' : ''}><svg x="${side * 400}" y="${y}" width="400" height="200" viewBox="${side * 1024} ${row * 512} 1024 512" overflow="hidden"><image href="${atlas}" width="2048" height="2048"/></svg></g>`;
}

export function handScene(left: TsuEFaChoice, right: TsuEFaChoice) {
  return `<svg viewBox="0 0 800 350" role="img" aria-label="Руки двух игроков, вид сбоку" class="td-hands">${hand(3, 0, 172)}${hand(3, 1, 172)}${hand(rows[left], 0, 0, true)}${hand(rows[right], 1, 0, true)}</svg>`;
}

export function handIcon(choice: TsuEFaChoice) {
  return `<svg viewBox="330 ${rows[choice] * 512 + 12} 694 488" class="td-choice-icon" aria-hidden="true" focusable="false" overflow="hidden"><image href="${atlas}" width="2048" height="2048"/></svg>`;
}
