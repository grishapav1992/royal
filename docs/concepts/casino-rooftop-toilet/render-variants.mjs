import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=process.cwd(),require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild'),{chromium}=require('@playwright/test');
const directory=path.join(root,'docs/concepts/casino-rooftop-toilet/variants');
mkdirSync(directory,{recursive:true});
const result=await build({absWorkingDir:root,stdin:{contents:"export {startVariant,variantChecks} from './docs/concepts/casino-rooftop-toilet/variants-scene';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'ToiletVariants',platform:'browser',logLevel:'silent'});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  let checks;const images={};
  for(const id of ['01-rectangle','02-l-shape','03-service-corridor']){
    const page=await browser.newPage({viewport:{width:1120,height:840},deviceScaleFactor:1}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<html><body style="margin:0;background:#202536"><div id="game"></div></body></html>');
    await page.addScriptTag({content:result.outputFiles[0].text});
    checks=await page.evaluate(()=>window.ToiletVariants.variantChecks());
    await page.evaluate(id=>{window.ToiletVariants.startVariant(id);},id);
    await page.waitForFunction(()=>window.__referenceReady===true);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(errors.length)throw Error(errors.join('\n'));
    const name=id+'.png';await page.locator('#game canvas').screenshot({path:path.join(directory,name)});
    const b=readFileSync(path.join(directory,name));images[name]={bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};
    await page.close();
  }
  const sources=['docs/concepts/casino-rooftop-toilet/variants-scene.ts','src/game/characters.ts','src/shared/appearance.ts','src/shared/clubGeometry.ts','src/game/navigation.ts'];
  writeFileSync(path.join(directory,'geometry.json'),JSON.stringify({format:1,referenceOnly:true,runtimeChanged:false,method:'Native Phaser renderer and original player atlas. Orthogonal floor plans, identical character scale, camera zoom, tile size and cubicle dimensions in every alternative. Proposed room-specific bounds and wall height, not an existing live hall.',variants:checks,sourceFiles:Object.fromEntries(sources.map(p=>[p,createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex')])),images},null,2)+'\n');
  console.log(JSON.stringify({images:Object.keys(images),variants:checks.map(v=>({id:v.id,approaches:v.approaches.length,pass:v.approaches.every(p=>p.path&&p.walkable)}))}));
}finally{await browser.close();}
