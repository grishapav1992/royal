import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {Client as PgClient} from 'pg';
import {temporaryDatabase} from '../../../scripts/database-test.ts';

const task=path.resolve(process.argv[2]),before=JSON.parse(fs.readFileSync(task+'/production-before.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const database=await temporaryDatabase(),env={...process.env,...database.env,AUTH_DB_PATH:'flag_audio_release',PORT:'2935',NILE_PLAY_SOCKET_FILE:''};
Object.assign(process.env,database.env);
const errors=[],report={cases:[],productionBalancesChanged:false},media=new Map();let backend,proxy,browser,room,probe;
const until=async(fn,label,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,150));}throw Error(label);};
try{
 const log=fs.openSync(task+'/host.log','w');backend=spawn(process.execPath,['dist-server/index.js'],{env,stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
 await until(()=>fetch('http://127.0.0.1:2935/healthz').then(r=>r.ok).catch(()=>false),'Backend health');
 proxy=http.createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html',file=path.resolve('dist',name),expected=before.program['dist/'+name];
  if(req.method==='GET'&&expected&&!fs.existsSync(file)){
   let saved=media.get(name);const local=path.resolve('public',name);if(!saved&&fs.existsSync(local)&&fs.statSync(local).isFile()){const bytes=fs.readFileSync(local);if(sha(bytes)===expected)saved={bytes,type:({'.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.mp3':'audio/mpeg','.woff2':'font/woff2'})[path.extname(name)]};}if(!saved){const reply=await fetch('https://stealth-spark-gokmxooi.expresshost.cloud/'+name);assert(reply.ok);const bytes=Buffer.from(await reply.arrayBuffer());assert.equal(sha(bytes),expected,'Production media changed: '+name);saved={bytes,type:reply.headers.get('content-type')};media.set(name,saved);}
   res.setHeader('Content-Type',saved.type||'application/octet-stream');res.end(saved.bytes);return;
  }
  const out=http.request({host:'127.0.0.1',port:2935,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});out.on('error',()=>res.destroy());req.pipe(out);
 }catch(error){errors.push(error.message);res.writeHead(500);res.end();}});
 proxy.on('upgrade',(req,socket,head)=>{const out=net.connect(2935,'127.0.0.1',()=>{out.write(req.method+' '+req.url+' HTTP/'+req.httpVersion+'\r\n'+req.rawHeaders.reduce((s,v,i)=>s+v+(i%2?'\r\n':': '),'')+'\r\n');if(head.length)out.write(head);socket.pipe(out);out.pipe(socket);});out.on('error',()=>socket.destroy());socket.on('error',()=>out.destroy());});
 await new Promise(r=>proxy.listen(5935,'127.0.0.1',r));
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({baseURL:'http://127.0.0.1:5935',viewport:{width:1440,height:1000}});
 const login=await context.request.post('/api/auth/login',{data:{email:'flag-audio-'+randomUUID()+'@example.test',password:'Flag-audio-test-123!'}});assert(login.ok());await context.request.post('/api/auth/character',{data:{skin:0}});
 const me=await(await context.request.get('/api/auth/me')).json();
 const db=new PgClient();await db.connect();await db.query('INSERT INTO flag_audio_release.demo_wallets(account_id,balance,fraction_units) VALUES($1,10000,0)',[me.account.id]);await db.query("INSERT INTO flag_audio_release.demo_ledger(account_id,operation_id,kind,amount,balance,created_at,amount_units,balance_units,entry_type,source) VALUES($1,$2,'deposit',10000,10000,$3,1000000,1000000,'deposit','test-fixture')",[me.account.id,randomUUID(),Date.now()]);await db.end();
 const owner=await browser.newContext({baseURL:'http://127.0.0.1:5935'});assert((await owner.request.post('/api/auth/login',{data:{email:'flag-owner-'+randomUUID()+'@example.test',password:'Flag-owner-test-123!'}})).ok());await owner.request.post('/api/auth/character',{data:{skin:0}});
 const cookie=(await owner.cookies()).map(c=>c.name+'='+c.value).join(';');
 const client=new Client('http://127.0.0.1:5935',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{const r=await owner.request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body});return new Response(await r.body(),{status:r.status(),headers:r.headers()});}});
 room=await client.create('lobby');for(const name of ['chat','activities','piano-note','notice','chat-check','security','ejected','pvp'])room.onMessage(name,()=>{});
 const page=await context.newPage();probe=page;page.on('pageerror',e=>errors.push(e.message));await page.route('https://luelonplay.com/demo-api/**',r=>r.fulfill({json:{games:[]}}));await page.goto('/?room='+room.roomId);
 await until(()=>page.evaluate(()=>window.royalDemo?.getState()?.online),'Connected host',45000);
 const state=()=>page.evaluate(()=>window.royalDemo.getMiniState());
 const close=async()=>{await page.locator('#mini-dialog .mini-top [data-close]').click();await until(async()=>!await page.locator('[data-platform-game="flag-battle"]').count().then(n=>n>0),'Closed game');};
 const open=async()=>{
  if(await page.locator('#room-overview').getAttribute('aria-pressed')!=='true')await page.locator('#room-overview').click();await page.locator('#games-tab').click();
  await until(async()=>{if(await page.locator('[data-platform-game="flag-battle"]').count().then(n=>n>0))return true;await page.locator('[data-cabinet="studio-cosmic-escape"]').click({timeout:600});await new Promise(r=>setTimeout(r,1500));return page.locator('#mini-dialog').isVisible();},'Catalogue');
  console.log('Catalogue IDs',await page.locator('[data-platform-game]').evaluateAll(ns=>ns.map(n=>n.dataset.platformGame)));await page.locator('[data-platform-game="flag-battle"]').click();await until(async()=>await page.locator('#mini-game').getAttribute('data-game-module-id')==='flag-battle','Flag module');await until(()=>page.locator('[data-fb="play"]').count(),'Flag UI');
 };
 const bets=async()=>{const r=await context.request.get('/api/demo-wallet',{headers:{'X-Royal-Account-Id':me.account.id}});assert(r.ok());return(await r.json()).entries.filter(e=>e.kind==='bet');};
 await open();await until(()=>page.locator('#chat-input').isVisible(),'Connected chat');await page.locator('[data-country="JP"]').click();
 await page.locator('[data-fb="play"]').click();await until(async()=>(await state())?.presenting,'Natural round started');await until(async()=>((await state())?.audio?.scheduled?.collision||0)>0,'Physical contact sounded',30000);const contact=await state();await page.locator('[data-fb="skip"]').click();await until(async()=>!(await state())?.presenting,'Confirmed result after skip');
 const natural=await state();assert(natural.audio.scheduled.collision>0);assert.equal(natural.audio.voices,0);assert(natural.audio.maxVoices<=16);await until(async()=>(await state()).audio.voices===0,'Audio tails ended');assert.equal((await bets()).length,1);
 report.cases.push({desktop:{width:1440,height:1000},audio:contact.audio,skipVoices:natural.audio.voices});
 await close();await open();assert.equal((await bets()).length,1);assert.deepEqual((await state()).audio.scheduled,{});
 await page.setViewportSize({width:390,height:844});await page.locator('[data-fb="play"]').scrollIntoViewIfNeeded();
 assert(await page.locator('[data-fb="play"]').isVisible());assert(await page.locator('.fb-root').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 const chat=page.locator('#mini-dialog .game-chat-toggle');if(await chat.isVisible()){await chat.click();await until(()=>page.locator('#chat-input').isVisible(),'Mobile chat');await page.locator('#club-chat-dock .game-chat-close').click();}else assert(await page.locator('#chat-input').isVisible());
 let accepted;await page.route('**/api/demo-wallet/expansion',async route=>{if(!accepted&&route.request().method()==='POST'){const r=await route.fetch({maxRetries:0});assert(r.ok());accepted={operation:route.request().postDataJSON(),reply:await r.json()};await route.abort('failed');}else await route.continue();});
 await page.locator('[data-fb="play"]').click();await until(()=>page.locator('[data-fb="retry"]').isVisible(),'Lost reply retry');await close();await open();await until(()=>page.locator('[data-fb="retry"]').isVisible(),'Reopened pending request');await page.locator('[data-fb="retry"]').click();await until(async()=>(await state())?.sessionId===accepted.operation.id,'Same UUID recovered');
 assert.equal((await bets()).length,2);await page.locator('[data-fb="skip"]').click();await close();await open();assert.equal((await bets()).length,2);assert.deepEqual((await state()).audio.scheduled,{});
 report.cases.push({mobile:{width:390,height:844},lostReplyUuid:accepted.operation.id,betEntries:2,reopenDebits:0});assert.deepEqual(errors,[]);report.passed=true;
}catch(error){report.error=error.message;if(probe){report.dom=(await probe.locator('body').innerText()).slice(0,12000);report.catalogue=await probe.locator('[data-platform-game]').evaluateAll(ns=>ns.map(n=>({id:n.dataset.platformGame,html:n.outerHTML.slice(0,300)})));report.state=await probe.evaluate(()=>window.royalDemo.getState()).catch(()=>null);await probe.screenshot({path:task+'/host-failure.png'});}throw error;}
finally{
 report.errors=errors;fs.writeFileSync(task+'/host-verification.json',JSON.stringify(report,null,2)+'\n');await room?.leave().catch(()=>{});await browser?.close();proxy?.closeAllConnections();proxy?.close();backend?.kill('SIGTERM');if(backend&&backend.exitCode===null)await Promise.race([new Promise(r=>backend.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);await database.cleanup();
}
