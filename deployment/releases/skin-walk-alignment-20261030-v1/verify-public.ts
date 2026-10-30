import { chromium, expect } from '@playwright/test';
import { misalignedSkinSheet } from '../../../tests/fixtures/skin-walk-sheet';
import { SKIN_THEME, SKIN_PRICE_UNITS } from '../../../src/shared/skinStudio';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin='https://stealth-spark-gokmxooi.expresshost.cloud',work='artifacts/work/skin-walk-alignment';
const phase=process.argv[2]??'after',png=await misalignedSkinSheet();
const patch=phase==='candidate'?JSON.parse(await fs.readFile(work+'/client-patch.json','utf8')):null;
const id='cccccccc-cccc-4ccc-8ccc-cccccccccccc',user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const account={id:user,name:'Проверка образа',email:'skin-walk@example.test',skin:0,appearance:null};
const cards=[id,'dddddddd-dddd-4ddd-8ddd-dddddddddddd'].map(id=>({id,jobId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prompt:'Проверка смещённых кадров',createdAt:1,description:'Тестовый образ',descriptionPending:false}));
const state={theme:SKIN_THEME,priceUnits:SKIN_PRICE_UNITS,variantCount:2,enabled:true,wardrobe:[],equippedId:null,job:{id:cards[0].jobId,prompt:'',state:'ready',variantCount:2,createdAt:1,variants:cards}};
const proof={phase,passed:false,productionWritesSent:0,mockedApi:true,files:[] as string[],errors:[] as string[],viewports:[] as object[]};
if(phase==='after'){
 const m=JSON.parse(await fs.readFile(work+'/source-lock.json','utf8'));
 for(const[name,sha]of Object.entries(m.delta)){const r=await fetch(origin+'/'+name,{cache:'no-store',signal:AbortSignal.timeout(30000)});expect(r.ok).toBe(true);expect(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')).toBe(sha);proof.files.push(name);}
}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport}),page=await context.newPage();page.on('pageerror',e=>proof.errors.push(e.message));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(!['http:','https:'].includes(url.protocol))return route.continue();
   if(url.origin!==origin)return route.abort();
   if(patch&&url.pathname==='/')return route.fulfill({contentType:'text/html',body:await fs.readFile(work+'/patched/index.html')});
   if(patch&&url.pathname==='/'+patch.file)return route.fulfill({contentType:'text/javascript',body:await fs.readFile(work+'/patched/'+patch.file)});
   if(url.pathname.startsWith('/api/skin-studio/assets/'))return route.fulfill({contentType:'image/png',body:png});
   if(url.pathname==='/api/auth/me')return route.fulfill({json:{account}});
   if(url.pathname==='/api/skin-studio')return route.fulfill({json:state});
   if(url.pathname==='/api/demo-wallet')return route.fulfill({json:{balance:40,entries:[]}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'Test-only disconnected service'}});
   if(!['GET','HEAD'].includes(req.method()))return route.abort();
   return route.continue();
  });
  await context.routeWebSocket('**/*',socket=>socket.close());
  await page.goto(origin+'/?skin-walk-proof='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await expect(page.locator('#loading')).toHaveCount(0,{timeout:120000});
  await expect(page.getByRole('button',{name:'Образы',exact:true})).toBeVisible();
  // Authentication and room requests are browser-local fixtures, never production sessions.
  await page.locator('#join-dialog').evaluate((dialog:HTMLDialogElement)=>{if(dialog.open)dialog.close();});
  await page.getByRole('button',{name:'Образы',exact:true}).click();
  await page.getByRole('button',{name:'Примерить вариант 1'}).click();
  await expect(page.locator('.skin-fitting-caption')).toContainText('Походи');
  const floor=page.getByLabel('Площадка для примерки скина');
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+100));
  await floor.focus();await page.keyboard.down('ArrowLeft');
  const samples:{x:number;y:number;facing:string|undefined}[]=[];
  try{for(let i=0;i<14;i++){
   await page.clock.runFor(40);
   samples.push(await floor.evaluate((el:HTMLCanvasElement)=>{
    const image=el.getContext('2d')!.getImageData(0,0,el.width,el.height);let x=0,y=0,n=0;
    for(let at=0;at<image.data.length;at+=4)if(image.data[at]>220&&image.data[at+1]>200&&image.data[at+2]<40&&image.data[at+3]>240){x+=at/4%image.width;y+=Math.floor(at/4/image.width);n++;}
    return{x:x/n,y:y/n,facing:el.dataset.facing};
   }));
  }}finally{await page.keyboard.up('ArrowLeft');}
  const maxBackstep=Math.max(...samples.slice(1).map((s,i)=>s.x-samples[i].x));
  const headVerticalRange=Math.max(...samples.map(s=>s.y))-Math.min(...samples.map(s=>s.y));
  expect(samples.every(s=>Number.isFinite(s.x)&&s.facing==='left')).toBe(true);
  if(phase!=='before'){expect(maxBackstep).toBeLessThanOrEqual(1);expect(headVerticalRange).toBeLessThan(4);}
  await page.screenshot({path:work+'/'+phase+'-'+viewport.width+'.png'});
  proof.viewports.push({...viewport,maxBackstep,headVerticalRange,samples:samples.length});await context.close();
 }
 expect(proof.errors).toEqual([]);proof.passed=true;
}finally{await browser.close();await fs.writeFile(work+'/'+phase+'-public.json',JSON.stringify(proof,null,2)+'\n');}
console.log(JSON.stringify(proof));
