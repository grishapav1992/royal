import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry, type Box } from '../games/dracona/layout';

const inside = (box: Box, width: number, height: number) => box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height;
const apart = (a: Box, b: Box) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

test('every part of the scene stays inside the window the host gives the game', () => {
  for (let width = 312; width <= 2600; width += 37) for (let height = 262; height <= 1450; height += 41) {
    const g = geometry(width, height), label = `${width}x${height} ${g.profile}`;
    // Windows smaller than the supported phones are outside the contract.
    if (g.profile === 'portrait' && height < 500 || g.profile === 'landscape' && width < 550) continue;
    for (const part of ['cabinet', 'niche', 'controls', 'tools'] as const) assert.ok(inside(g[part], width, height), `${label}: ${part} ${JSON.stringify(g[part])}`);
    assert.ok(apart(g.cabinet, g.controls), label + ': the controls cover the cabinet');
    if (g.profile !== 'full') assert.ok(apart(g.cabinet, g.niche), label + ': the reserve covers the cabinet');
    assert.ok(g.controls.h >= 92 || g.profile === 'full' && g.controls.h >= 80, label);
    assert.ok(g.cell >= 24, label + ': the cells are too small');
  }
});

test('reference windows keep a readable field and their own composition', () => {
  const cases = [[1104, 847, 'full', 120], [1434, 847, 'full', 120], [900, 600, 'full', 76], [2560, 1390, 'full', 190], [393, 802, 'portrait', 66],
    [762, 974, 'portrait', 100], [320, 518, 'portrait', 52], [852, 343, 'landscape', 58], [568, 270, 'landscape', 46]] as const;
  for (const [width, height, profile, cell] of cases) {
    const g = geometry(width, height);
    assert.equal(g.profile, profile);
    assert.ok(g.cell >= cell, `${width}x${height}: ${g.cell}`);
  }
  assert.ok(geometry(393, 802).hero && geometry(852, 343).hero && geometry(1104, 847).hero);
  assert.equal(geometry(320, 518).hero, undefined);
});

test('the field depends only on the window, never on the round', () => {
  assert.deepEqual(geometry(1104, 847), geometry(1104, 847));
});
