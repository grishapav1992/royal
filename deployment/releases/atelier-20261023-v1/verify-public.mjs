import { chromium } from '@playwright/test';
import fs from 'node:fs';
import crypto from 'node:crypto';
const base='https://stealth-spark-gokmxooi.expresshost.cloud';
const folder='artifacts/atelier-release/proof';fs.mkdirSync(folder,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(process.env.ATELIER_PUBLIC_MANIFEST || 'artifacts/atelier-release/payload/install-manifest.json'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function request(path,options={}){
  for(let attempt=0;;attempt++){
    try{
      const response=await fetch(base+path,{cache:'no-store',...options,signal:AbortSignal.timeout(25000)});
      const body=Buffer.from(await response.arrayBuffer());
      if([502,503,504].includes(response.status)&&attempt<2){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}
      return {ok:response.ok,status:response.status,body};
    }catch(error){
      if(attempt>=2)throw error;
      await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
    }
  }
}
const waitUntil=Date.now()+Number(process.env.ATELIER_WAIT_FOR_PUBLISH_MS || 0);
if(waitUntil>Date.now()){
  for(;;){
    const r=await request('/index.html');
    if(r.ok&&sha(r.body)===manifest.delta['index.html'])break;
    if(Date.now()>waitUntil)throw Error('The expected combined release has not become public');
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
}
const files=Object.entries(manifest.delta);
for(let i=0;i<files.length;i+=4)await Promise.all(files.slice(i,i+4).map(async([name,digest])=>{
  const r=await request('/'+name);
  if(!r.ok||sha(r.body)!==digest)throw Error('Public file differs: '+name);
}));
if(!JSON.parse((await request('/healthz')).body.toString()).ok)throw Error('Public health failed');
if((await request('/api/skin-studio')).status!==401)throw Error('Anonymous atelier authorization failed');
if((await request('/api/skin-studio/generations',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'})).status!==403)throw Error('Cross-site atelier authorization failed');
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/?offline=1',{waitUntil:'load'});await page.locator('#loading').waitFor({state:'detached'});
    const initial=await page.evaluate(()=>window.royalDemo.getState()),box=await page.locator('#game canvas').boundingBox();
    await page.mouse.click(box.x+(initial.x-initial.view.x)*initial.view.zoom,box.y+(initial.y-initial.view.y)*initial.view.zoom);
    await page.keyboard.down('w');
    try{await page.waitForFunction(()=>window.royalDemo.getState().y<250,null,{timeout:20000});}finally{await page.keyboard.up('w');}
    await page.waitForFunction(()=>window.royalDemo.getTailor()?.blinks>0,null,{timeout:15000});
    const state=await page.evaluate(()=>({tailor:window.royalDemo.getTailor(),room:window.royalDemo.getState()}));
    if(!state.tailor||state.tailor.width!==56)throw Error('Tailor art is missing or incorrectly scaled');
    await page.screenshot({path:folder+'/production-'+viewport.width+'.png'});
    await page.mouse.click(box.x+(570-state.room.view.x)*state.room.view.zoom,box.y+(85-state.room.view.y)*state.room.view.zoom);
    await page.getByText('Войди в аккаунт, чтобы заказать образ в ателье.',{exact:true}).waitFor();
    if(errors.length)throw Error(errors.join('; '));
    results.push({viewport,tailorPresent:true,blinking:true,interaction:true,errors});await page.close();
  }
}finally{await browser.close();}
const result={ok:true,verifiedAt:new Date().toISOString(),release:manifest.release,sourceCommit:manifest.sourceCommit,manifestSha256:sha(Buffer.from(JSON.stringify(manifest))),publicFilesVerified:files.length,health:true,anonymousDenied:true,crossSiteDenied:true,browsers:results,productionAccountsOrMoneyModified:false};
fs.writeFileSync('deployment/releases/atelier-20261023-v1/public-verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
