import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE_GITHUB_GAMES, ARCADE_HOUSE_GAMES, ARCADE_PROVIDER_GAMES } from '../src/shared/arcadeCatalog';
import { FIRST_FLOOR_ART, FIRST_FLOOR_GAME_THEMES } from '../src/ui/FirstFloorGameArt';

test('visual redesign covers exactly the active first-floor GitHub collection', () => {
  assert.deepEqual(Object.keys(FIRST_FLOOR_GAME_THEMES).sort(), [...ARCADE_GITHUB_GAMES].sort());
  for (const id of [...ARCADE_HOUSE_GAMES, ...ARCADE_PROVIDER_GAMES]) assert.equal(Object.hasOwn(FIRST_FLOOR_GAME_THEMES, id), false, id);
});

test('each selected game has its own artwork, title and palette', () => {
  const ids = Object.values(FIRST_FLOOR_GAME_THEMES);
  assert.equal(new Set(ids).size, ids.length);
  const themes = ids.map(id => FIRST_FLOOR_ART[id]);
  for (const field of ['scene', 'emblem'] as const) assert.equal(new Set(themes.map(theme => theme[field])).size, themes.length);
  for (const index of [0, 1]) assert.equal(new Set(themes.map(theme => theme.title[index])).size, themes.length);
  assert.equal(new Set(themes.map(theme => theme.palette.join(','))).size, themes.length);
  for (const theme of themes) {
    assert.ok(!/<(?:script|foreignObject|image)\b|\bon\w+=|https?:/i.test(theme.scene + theme.emblem));
    for (const colour of theme.palette) assert.match(colour, /^#[a-f0-9]{6}$/i);
  }
});
