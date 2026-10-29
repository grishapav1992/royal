import {test,expect,type Page} from '@playwright/test';
import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';

const game=(page:Page)=>page.frameLocator('.temple-frame');
const state=(page:Page)=>page.evaluate(()=>(window as any).templePreview.state());
const sizes=[[1440,1000],[1000,760],[1000,1100],[768,1024],[760,1000],[600,900],[521,900],[390,844],[360,740]];

async function framing(page:Page){
  await game(page).locator('.ft').evaluate(root=>new Promise<void>(resolve=>root.ownerDocument.defaultView!.requestAnimationFrame(()=>resolve())));
  return game(page).locator('.ft').evaluate(root=>{
    const rect=(selector:string)=>{const r=root.querySelector(selector)!.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const board=rect('.ft-cabinet'),character=rect('.ft-character'),portrait=rect('.ft-portrait:not([hidden])'),console=rect('.ft-console');
    const overlap=Math.max(0,Math.min(board.right,character.right)-Math.max(board.left,character.left))*Math.max(0,Math.min(board.bottom,character.bottom)-Math.max(board.top,character.top));
    return {width:root.clientWidth,scroll:root.scrollWidth,board,character,portrait,console,overlap,roomWidth:rect('[data-room]').width,roomHeight:rect('[data-room]').height};
  });
}

test('every responsive scene keeps the explorer outside the board in base and expedition maps',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/tests/fixtures/temple-preview.html?lang=ru');
  await expect(game(page).locator('[data-ft=primary]')).toBeEnabled();
  await expect.poll(async()=>(await state(page)).feedback.character.loaded.length).toBe(6);
  const records:unknown[]=[];
  for(const mode of ['base','bonus']){
    if(mode==='bonus'){
      await game(page).locator('[data-ft=primary]').click();
      await expect.poll(async()=>(await state(page)).revision).toBe(1);
      await expect.poll(async()=>(await state(page)).busy).toBe(false);
    }
    for(const [width,height]of sizes){
      await page.setViewportSize({width,height});
      const g=await framing(page);records.push({mode,width,height,...g});
      expect(g.overlap,`${mode} ${width}x${height}: explorer is covered by the board`).toBe(0);
      expect(g.scroll).toBeLessThanOrEqual(g.width+1);
      expect(Math.min(g.roomWidth,g.roomHeight)).toBeGreaterThanOrEqual(44);
      if(width>520){
        expect(g.character.right).toBeLessThanOrEqual(g.board.left-8);
        expect(g.portrait.left).toBeGreaterThanOrEqual(g.character.left);
        expect(g.portrait.right).toBeLessThanOrEqual(g.character.right);
        expect(g.portrait.top).toBeGreaterThanOrEqual(g.character.top);
        expect(g.portrait.bottom).toBeLessThanOrEqual(g.character.bottom);
        expect(g.character.bottom).toBeLessThanOrEqual(g.console.top);
      }else expect(g.character.bottom).toBeLessThanOrEqual(g.board.top);
    }
  }
  await writeFile('artifacts/work/flooded-temple-framing/geometry.json',JSON.stringify(records,null,2));
  await page.setViewportSize({width:1000,height:1100});
  await game(page).locator('.ft').evaluate(root=>root.ownerDocument.scrollingElement!.scrollTop=0);
  await mkdir('docs/assets/flooded-temple',{recursive:true});
  await sharp(await page.screenshot()).webp({quality:82}).toFile('docs/assets/flooded-temple/character-framing.webp');
  expect(errors).toEqual([]);
});
