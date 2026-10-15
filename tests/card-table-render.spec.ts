import { test, expect, type Page } from '@playwright/test';

const probe = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>html,body{margin:0;background:#23313c}canvas{display:block}#host{width:1100px;height:720px}</style></head><body><div id="host"></div><script type="module">
import Phaser from '/node_modules/.vite/deps/phaser.js';
import {CABINETS} from '/src/shared/cabinets.ts';
import {CARD_GAMES,dealerForGame,isCardGame} from '/src/shared/cardTables.ts';
import {createDetailedArt} from '/src/game/materials.ts';
import {CardTablesRenderer} from '/src/game/CardTablesRenderer.ts';
import {drawDealer,DEALER_SIZE} from '/src/game/dealerArt.ts';
class ProbeScene extends Phaser.Scene{
  create(){
    createDetailedArt(this);this.cameras.main.setBackgroundColor('#25383d');
    this.cameras.main.setScroll(950,155);this.add.image(55,174,'club-floor-github').setOrigin(0).setDepth(-1);
    const cabinets=CABINETS.filter(c=>isCardGame(c.id));this.renderer=new CardTablesRenderer(this,cabinets,id=>this.clicked=id);
    window.cardRenderProbe={scene:this,cabinets,allCabinets:CABINETS,profiles:CARD_GAMES.map(dealerForGame),drawDealer,DEALER_SIZE};
  }
  update(time){this.renderer?.update(time);}
}
new Phaser.Game({type:Phaser.CANVAS,width:1100,height:720,parent:'host',scene:ProbeScene,audio:{noAudio:true}});
</script></body></html>`;
async function ready(page: Page) {
  await page.route('**/__card_table_probe', route => route.fulfill({ contentType: 'text/html', body: probe }));
  await page.goto('/__card_table_probe'); await page.waitForFunction(() => Boolean((window as any).cardRenderProbe));
}

test('all 33 card games have personal furniture and visible unique dealer portraits', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await ready(page);
  const state = await page.evaluate(() => {
    const { scene, cabinets, allCabinets, profiles, drawDealer, DEALER_SIZE } = (window as any).cardRenderProbe;
    const portraits = profiles.map((profile: any) => { const c = document.createElement('canvas'); c.width = DEALER_SIZE.width; c.height = DEALER_SIZE.height; drawDealer(c.getContext('2d'), profile); return c.toDataURL(); });
    return {
      tables: scene.children.list.filter((object: any) => object.name.startsWith('card-table-') && !object.name.startsWith('card-table-hit-') && !object.name.startsWith('card-table-name-') && !object.name.startsWith('card-table-rug-')).length,
      stools: scene.children.list.filter((object: any) => object.name.startsWith('cabinet-stool-')).map((object: any) => ({ id:object.name.slice('cabinet-stool-'.length), x:object.x, y:object.y, visible:object.visible })),
      expectedSeats: cabinets.map((cabinet: any) => ({ id:cabinet.id, x:cabinet.x-72, y:cabinet.y+43, visible:true })),
      names: profiles.map((p: any) => p.name), uniquePortraits: new Set(portraits).size,
      obsoleteTextures: cabinets.filter((c: any) => scene.textures.exists('cabinet-' + allCabinets.indexOf(c))).map((c: any) => c.id),
      atlasBytes: profiles.reduce((sum: number, profile: any) => sum + ['body','hands'].reduce((size, layer) => { const image = scene.textures.get(profile.id+'-'+layer).getSourceImage(); return size + image.width*image.height*4; }, 0), 0),
    };
  });
  expect(state.tables).toBe(33); expect(state.obsoleteTextures).toEqual([]); expect(new Set(state.names).size).toBe(33); expect(state.uniquePortraits).toBe(33); expect(state.atlasBytes).toBeLessThan(22 * 1024 * 1024);
  const byId = (a: {id:string}, b: {id:string}) => a.id.localeCompare(b.id);
  expect(state.stools.sort(byId)).toEqual(state.expectedSeats.sort(byId));
  expect(errors).toEqual([]); await page.screenshot({ path: 'artifacts/royal-card-floor-20261011/card-tables-render.png' });
});

test('dealing animates cards and the clicked table keeps its own identity', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { const p = (window as any).cardRenderProbe; p.scene.renderer.setAction('github-blackjack','deal'); });
  await page.waitForTimeout(80);
  const start = await page.evaluate(() => { const p = (window as any).cardRenderProbe; return p.scene.children.list.find((o: any) => o.name === 'card-deck-github-blackjack-0').x; });
  await page.waitForTimeout(430);
  const later = await page.evaluate(() => { const p = (window as any).cardRenderProbe; return p.scene.children.list.find((o: any) => o.name === 'card-deck-github-blackjack-0').x; });
  expect(later).toBeLessThan(start - 20);
  await page.mouse.click(170, 160); expect(await page.evaluate(() => (window as any).cardRenderProbe.scene.clicked)).toBe('github-blackjack');
  await page.evaluate(() => { (window as any).cardRenderProbe.scene.clicked = null; });
  await page.mouse.click(98, 206); expect(await page.evaluate(() => (window as any).cardRenderProbe.scene.clicked)).toBe('github-blackjack');
});

test('reduced motion displays the gesture without moving cards or arms', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await ready(page);
  await page.evaluate(() => { (window as any).cardRenderProbe.scene.renderer.setAction('github-blackjack','deal'); });
  await page.waitForTimeout(80);
  const state = () => page.evaluate(() => { const p = (window as any).cardRenderProbe; return p.scene.children.list.filter((o: any) => o.name === 'card-deck-github-blackjack-0' || o.name === 'dealer-github-blackjack-hands').map((o: any) => ({ x:o.x, y:o.y, frame:o.frame.name })); });
  const before = await state(); await page.waitForTimeout(400); expect(await state()).toEqual(before);
});
