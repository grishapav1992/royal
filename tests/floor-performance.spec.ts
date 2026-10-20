import { test, expect, type Page } from '@playwright/test';

const output = 'artifacts/browser-smoothness-20261016';

async function ready(page: Page, reducedMotion = false) {
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  // Nested release builds can emit index.html and trigger an unrelated Vite reload.
  await page.routeWebSocket('**/*', socket => socket.close());
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
    }
    return route.continue();
  });
  await page.goto('/?offline=1', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    // Capture the actual room without exposing additional production APIs.
    // Vite adds an HMR timestamp to imported modules after local source changes.
    const source = await (await fetch('/src/game/RoomScene.ts')).text();
    const moduleUrl = source.match(/from\s*["']([^"']*\/roomDetails\.ts[^"']*)["']/)?.[1];
    if (!moduleUrl) throw new Error('RoomDetails module was not found in the served room source');
    const { RoomDetails } = await import(moduleUrl);
    const update = RoomDetails.prototype.update;
    RoomDetails.prototype.update = function (...args: [number, boolean?]) {
      (window as any).__performanceRoom = (this as any).scene;
      return update.apply(this, args);
    };
  });
  await page.waitForFunction(() => Boolean((window as any).__performanceRoom?.player) && !document.querySelector('#loading'));
}

test('all cabinet previews retain their positions, artwork and depth as atlas images', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  const result = await page.evaluate(async () => {
    const { CABINET_SCALE, CABINET_SIZE, cabinetScreen } = await import('/src/game/cabinetArt.ts');
    const { cabinetsInHall } = await import('/src/shared/cabinets.ts');
    const room = (window as any).__performanceRoom, details = room.details;
    const cabinets = cabinetsInHall('arcade');
    return {
      expectedScreens: cabinets.length,
      screens: details.screens.map((screen: any, index: number) => {
        const cabinet = cabinets[index], bounds = cabinetScreen(cabinet);
        return {
          type: screen.type,
          x: screen.x, expectedX: cabinet.x + (bounds.x - CABINET_SIZE.width / 2) * CABINET_SCALE,
          y: screen.y, expectedY: cabinet.y + (bounds.y - CABINET_SIZE.height) * CABINET_SCALE,
          width: screen.displayWidth, expectedWidth: bounds.width * CABINET_SCALE,
          height: screen.displayHeight, expectedHeight: bounds.height * CABINET_SCALE,
          depth: screen.depth, expectedDepth: cabinet.y + .2,
          originX: screen.originX, originY: screen.originY,
          visible: screen.visible,
          vectorOverlays: room.children.list.filter((object: any) => object.type === 'Graphics' && object.x === screen.x && object.y === screen.y && object.depth === screen.depth).length,
          texture: screen.texture.key,
        };
      }),
      painterDisplayed: room.children.list.includes(details.painter),
      emptyFloors: ['tables', 'github'].map(hall => ({ hall, screens: room.hallDetails.get(hall).screens.length, atlas: Boolean(room.hallDetails.get(hall).atlas) })),
    };
  });
  expect(result.screens).toHaveLength(result.expectedScreens);
  expect(new Set(result.screens.map(screen => screen.texture)).size).toBe(1);
  for (const screen of result.screens) {
    expect(screen.type).toBe('Image');
    expect(screen.x).toBeCloseTo(screen.expectedX, 8);
    expect(screen.y).toBeCloseTo(screen.expectedY, 8);
    expect(screen.width).toBeCloseTo(screen.expectedWidth, 8);
    expect(screen.height).toBeCloseTo(screen.expectedHeight, 8);
    expect(screen.depth).toBeCloseTo(screen.expectedDepth, 8);
    expect(screen.originX).toBe(0); expect(screen.originY).toBe(0);
    expect(screen.visible).toBe(true); expect(screen.vectorOverlays).toBe(0);
  }
  expect(result.painterDisplayed).toBe(false);
  expect(result.emptyFloors).toEqual([{ hall: 'tables', screens: 0, atlas: false }, { hall: 'github', screens: 0, atlas: false }]);
  await page.screenshot({ path: `${output}/desktop-previews.png` });
  await page.locator('#room-overview').click();
  await expect(page.locator('#room-overview')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `${output}/desktop-overview.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#room-overview').click();
  await expect(page.locator('#room-overview')).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: `${output}/mobile-previews.png` });
  expect(errors).toEqual([]);
});

test('preview updates bound work per frame, cover visible cabinets and reuse allocations', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => {
    const room = (window as any).__performanceRoom, details = room.details;
    room.game.loop.sleep();
    const camera = room.cameras.main, originalView = { x: camera.worldView.x, y: camera.worldView.y, width: camera.worldView.width, height: camera.worldView.height };
    const atlas = details.atlas, painter = details.painter;
    const textureCount = room.textures.getTextureKeys().length;
    const atlasCanvas = atlas.canvas, scratch = details.scratch;
    const hashCell = (screen: any) => {
      const frame = screen.frame;
      const bytes = atlas.context.getImageData(frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight).data;
      let hash = 2166136261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
      return hash >>> 0;
    };
    const upload = atlas.source[0].glTexture;
    const originalPaint = painter.generateTexture, originalRefresh = upload.update;
    let paints = 0, uploads = 0;
    painter.generateTexture = function (...args: any[]) { paints++; return originalPaint.apply(this, args); };
    upload.update = function (...args: any[]) { uploads++; return originalRefresh.apply(this, args); };
    let time = (details.lastFrame + 1) * 110;
    let maxPaintsPerUpdate=0,maxUploadsPerUpdate=0;
    const update = () => { for(let pass=0;pass<=Math.ceil(details.screens.length/8);pass++){const p=paints,u=uploads;details.update(time);maxPaintsPerUpdate=Math.max(maxPaintsPerUpdate,paints-p);maxUploadsPerUpdate=Math.max(maxUploadsPerUpdate,uploads-u);} time += 110; };
    try {
      camera.worldView.setTo(0, 0, 1100, 900);
      const before = details.screens.map(hashCell);
      update();
      const normalPaints = paints, normalUploads = uploads;
      const sameFramePaints = paints;
      details.update(time - 110);
      const repeatedFramePaints = paints - sameFramePaints;
      const beforeLoopPaints = paints, beforeLoopUploads = uploads;
      for (let index = 0; index < 20; index++) update();
      const after = details.screens.map(hashCell);
      const normalChanges = before.map((hash: number, index: number) => hash !== after[index]);
      const repeatedPaints = paints - beforeLoopPaints, repeatedUploads = uploads - beforeLoopUploads;
      camera.worldView.setTo(-20,-20,room.getState().world.width+40,room.getState().world.height+40);
      const beforeOverviewPaints = paints, beforeOverviewUploads = uploads;
      update();
      const overviewPaints = paints - beforeOverviewPaints, overviewUploads = uploads - beforeOverviewUploads;
      const beforeAnimation = details.screens.map(hashCell);
      for (let index = 0; index < 5; index++) update();
      const afterAnimation = details.screens.map(hashCell);
      camera.worldView.setTo(-2000, -2000, 100, 100);
      const beforeEmptyPaints = paints, beforeEmptyUploads = uploads;
      update();
      return {
        screenCount:details.screens.length,normalPaints, normalUploads, repeatedFramePaints, repeatedPaints, repeatedUploads,
        normalChangedCount: normalChanges.filter(Boolean).length,
        overviewPaints, overviewUploads,
        animatedCellCount: beforeAnimation.filter((hash: number, index: number) => hash !== afterAnimation[index]).length,
        emptyPaints: paints - beforeEmptyPaints, emptyUploads: uploads - beforeEmptyUploads,
        textureGrowth: room.textures.getTextureKeys().length - textureCount,
        sameAtlas: atlas.canvas === atlasCanvas, sameScratch: details.scratch === scratch,
        painterDisplayed: room.children.list.includes(painter), maxPaintsPerUpdate, maxUploadsPerUpdate,
      };
    } finally {
      painter.generateTexture = originalPaint; upload.update = originalRefresh;
      camera.worldView.setTo(originalView.x, originalView.y, originalView.width, originalView.height);
      room.game.loop.wake();
    }
  });
  expect(result.normalPaints).toBeGreaterThan(0); expect(result.normalPaints).toBeLessThan(result.screenCount);
  expect(result.normalUploads).toBe(Math.ceil(result.normalPaints/8)); expect(result.repeatedFramePaints).toBe(0);
  expect(result.repeatedPaints).toBe(result.normalPaints * 20); expect(result.repeatedUploads).toBe(result.normalUploads*20);
  expect(result.normalChangedCount).toBeGreaterThan(0); expect(result.normalChangedCount).toBeLessThanOrEqual(result.normalPaints);
  expect(result.overviewPaints).toBe(result.screenCount); expect(result.overviewUploads).toBe(Math.ceil(result.screenCount/8));
  expect(result.maxPaintsPerUpdate).toBeLessThanOrEqual(8); expect(result.maxUploadsPerUpdate).toBeLessThanOrEqual(1);
  expect(result.animatedCellCount).toBeGreaterThan(0);
  expect(result.emptyPaints).toBe(0); expect(result.emptyUploads).toBe(0);
  expect(result.textureGrowth).toBe(0); expect(result.sameAtlas).toBe(true); expect(result.sameScratch).toBe(true);
  expect(result.painterDisplayed).toBe(false);
});

test('floor buttons reach every floor and cabinet animation resumes after returning', async ({ page }) => {
  await ready(page);
  const initial = await page.evaluate(() => {
    const details = (window as any).__performanceRoom.details;
    (window as any).__previewAtlas = details.atlas;
    return details.atlas.key;
  });
  for (const target of ['tables', 'github', 'tables', 'arcade']) {
    await page.evaluate(async target => {
      const { hallLinks } = await import('/src/shared/world.ts');
      const room = (window as any).__performanceRoom;
      const link = hallLinks(room.hall).find((link: any) => link.target === target)!;
      const y = link.door.entry.y + (link.door.facing === 'up' ? -65 : 65);
      Object.assign(room.player, { x: link.door.entry.x, y, path: [], seat: '', action: 'idle', moving: false });
      room.player.sprite.setPosition(room.player.x, room.player.y);
    }, target);
    await page.locator(`#floor-links [data-floor-target="${target}"]`).click();
    await expect.poll(() => page.evaluate(() => (window as any).__performanceRoom.hall)).toBe(target);
    const state = await page.evaluate(() => {
      const room = (window as any).__performanceRoom;
      return { active: room.details.screens.filter((screen: any) => screen.visible).length,
        arcadeVisible: room.hallDetails.get('arcade').screens.filter((screen: any) => screen.visible).length,
        arcadeCount:room.hallDetails.get('arcade').screens.length,
        sameAtlas: room.hallDetails.get('arcade').atlas === (window as any).__previewAtlas,
        atlasCount: room.textures.getTextureKeys().filter((key: string) => key === (window as any).__previewAtlas.key).length };
    });
    expect(state.active).toBe(target === 'arcade' ? state.arcadeCount : 0);
    expect(state.arcadeVisible).toBe(target === 'arcade' ? state.arcadeCount : 0);
    expect(state.sameAtlas).toBe(true); expect(state.atlasCount).toBe(1);
  }
  await page.locator('#room-overview').click();
  const picture = () => page.evaluate(() => (window as any).__performanceRoom.details.atlas.canvas.toDataURL());
  const before = await picture();
  await expect.poll(picture).not.toBe(before);
  expect(await page.evaluate(() => (window as any).__performanceRoom.details.atlas.key)).toBe(initial);
});

test('reduced motion paints every initial preview and shutdown removes its resources', async ({ page }) => {
  await ready(page, true);
  const result = await page.evaluate(() => {
    const room = (window as any).__performanceRoom, details = room.details;
    room.game.loop.sleep();
    const atlas = details.atlas, painter = details.painter, key = atlas.key;
    const initialized = details.screens.map((screen: any) => {
      const frame = screen.frame, bytes = atlas.context.getImageData(frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight).data;
      let opaque = 0, art = 0;
      for (let index = 0; index < bytes.length; index += 4) {
        if (bytes[index + 3] === 255) opaque++;
        if (bytes[index] !== 8 || bytes[index + 1] !== 20 || bytes[index + 2] !== 32) art++;
      }
      return { opaque, art, pixels: bytes.length / 4 };
    });
    const before = atlas.canvas.toDataURL();
    let uploads = 0;
    const upload=atlas.source[0].glTexture,refresh=upload.update;
    upload.update = function (...args:any[]) { uploads++; return refresh.apply(this,args); };
    for (const time of [1000, 2000, 3000, 10000]) details.update(time);
    const unchanged = before === atlas.canvas.toDataURL();
    upload.update = refresh;
    const atlasKeysBefore = room.textures.getTextureKeys().filter((textureKey: string) => textureKey === key).length;
    room.scene.manager.stop('room');
    return { initialized, expectedScreens:details.cabinets.length, unchanged, uploads, atlasKeysBefore,
      atlasExistsAfter: room.textures.exists(key), painterDestroyed: painter.scene == null,
      allPreviewAtlasesRemoved: [...room.hallDetails.values()].every((floor: any) => !floor.atlas || !room.textures.exists(floor.atlas.key)) };
  });
  expect(result.initialized).toHaveLength(result.expectedScreens);
  for (const cell of result.initialized) { expect(cell.opaque).toBe(cell.pixels); expect(cell.art).toBeGreaterThan(0); }
  expect(result.unchanged).toBe(true); expect(result.uploads).toBe(0); expect(result.atlasKeysBefore).toBe(1);
  expect(result.atlasExistsAfter).toBe(false); expect(result.painterDestroyed).toBe(true); expect(result.allPreviewAtlasesRemoved).toBe(true);
});

test('uploaded preview pixels match the canvas and reuse the same GPU buffer',async({page})=>{
  await ready(page);
  const result=await page.evaluate(()=>{
    const room=(window as any).__performanceRoom,details=room.details,atlas=details.atlas;
    room.game.loop.sleep();details.update(1100,true);
    const texture=atlas.source[0].glTexture,buffer=texture.pixels;
    details.update(2200,true);
    const expected=atlas.context.getImageData(0,0,atlas.width,atlas.height).data;
    const gl=room.game.renderer.gl,prior=gl.getParameter(gl.FRAMEBUFFER_BINDING),framebuffer=gl.createFramebuffer();
    const actual=new Uint8Array(expected.length);
    let complete=false;
    try{
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture.webGLTexture,0);
      complete=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
      gl.readPixels(0,0,atlas.width,atlas.height,gl.RGBA,gl.UNSIGNED_BYTE,actual);
    }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,prior);gl.deleteFramebuffer(framebuffer)}
    const mismatches=actual.reduce((sum,byte,index)=>sum+Number(byte!==expected[index]),0);
    room.game.loop.wake();
    return{complete,mismatches,sameBuffer:buffer===texture.pixels,bytes:actual.length};
  });
  expect(result.complete).toBe(true);expect(result.mismatches).toBe(0);expect(result.sameBuffer).toBe(true);expect(result.bytes).toBeGreaterThan(1000000);
});

test('static decoration keeps plant positions and depth, shares bounded textures and cleans up',async({page})=>{
  await ready(page);
  const result=await page.evaluate(async()=>{
    const room=(window as any).__performanceRoom;
    const {clubPlants}=await import('/src/shared/clubLayout.ts');
    const keys=room.textures.getTextureKeys().filter((key:string)=>key.startsWith('room-club-decoration-'));
    const textures=keys.map((key:string)=>{const t=room.textures.get(key),source=t.getSourceImage(),data=source.getContext('2d').getImageData(0,0,source.width,source.height).data;let visible=0;for(let i=3;i<data.length;i+=4)if(data[i])visible++;return{key,width:source.width,height:source.height,visible}});
    const positions=['arcade','tables','github'].flatMap(hall=>{
      const images=room.hallObjects.get(hall).filter((object:any)=>object.name==='room-club-decoration-plant');
      return clubPlants(hall as any).map((plant:any,index:number)=>({x:images[index].x,y:images[index].y,depth:images[index].depth,expectedX:plant.x-34,expectedY:plant.y-82,expectedDepth:plant.y,type:images[index].type}));
    });
    room.scene.manager.stop('room');
    return{textures,positions,removed:keys.every((key:string)=>!room.textures.exists(key))};
  });
  expect(result.textures).toHaveLength(5);
  expect(result.textures.reduce((sum,t)=>sum+t.width*t.height*4,0)).toBeLessThan(5*1024*1024);
  for(const texture of result.textures){expect(texture.visible).toBeGreaterThan(0);expect(texture.width).toBeLessThanOrEqual(4096);expect(texture.height).toBeLessThanOrEqual(4096)}
  for(const p of result.positions){expect(p.type).toBe('Image');expect(p.x).toBe(p.expectedX);expect(p.y).toBe(p.expectedY);expect(p.depth).toBe(p.expectedDepth)}
  expect(result.removed).toBe(true);
});
