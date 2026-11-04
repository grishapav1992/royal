import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=process.cwd(),require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild'),{chromium}=require('@playwright/test');
const directory=path.join(root,'docs/concepts/casino-rooftop-toilet');
mkdirSync(directory,{recursive:true});
const result=await build({absWorkingDir:root,stdin:{contents:"export {startReference,geometryChecks} from './docs/concepts/casino-rooftop-toilet/reference-scene';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'ToiletReference',platform:'browser',logLevel:'silent'});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  let checks;const images={};
  for(const mode of ['roof','room'])for(const close of [false,true]){
    const page=await browser.newPage({viewport:{width:1120,height:840},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<html><body style="margin:0;background:#191d35"><div id="game"></div></body></html>');
    await page.addScriptTag({content:result.outputFiles[0].text});
    checks=await page.evaluate(()=>window.ToiletReference.geometryChecks());
    await page.evaluate(({mode,close})=>{window.ToiletReference.startReference(mode,close);},{mode,close});
    await page.waitForFunction(()=>window.__referenceReady===true);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const name=mode+'-'+(close?'close':'overview')+'.png';await page.locator('#game canvas').screenshot({path:path.join(directory,name)});
    if(errors.length)throw Error(errors.join('\n'));
    const b=readFileSync(path.join(directory,name));images[name]={bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};
    await page.close();
  }
  const sources=['src/shared/rooftop.ts','src/shared/clubGeometry.ts','src/game/RooftopRenderer.ts','src/game/characters.ts','src/game/navigation.ts','src/game/RoomScene.ts'];
  writeFileSync(path.join(directory,'geometry.json'),JSON.stringify({format:1,referenceOnly:true,runtimeChanged:false,method:'Code-native Phaser references. Existing RooftopRenderer, character renderer, camera equations and pathfinding are imported from the project.',...checks,sourceFiles:Object.fromEntries(sources.map(p=>[p,createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex')])),images},null,2)+'\n');
  console.log(JSON.stringify({images:Object.keys(images),checks:{roofNoOverlap:checks.roof.noOverlap,roofPerimeter:checks.roof.perimeterReachable,interiorApproaches:checks.room.approaches.every(p=>p.path&&p.walkable)}}));
}finally{await browser.close();}
