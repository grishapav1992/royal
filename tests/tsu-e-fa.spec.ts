import {test,expect,type Page,type Browser} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderTsuCue,type TsuCue} from '../games/tsu-e-fa/TsuSounds';
const base='http://127.0.0.1:5193';
const connected=(p:Page)=>expect.poll(()=>p.evaluate(()=>(window as any).royalDemo?.getNetworkState()?.status),{timeout:30000}).toBe('connected');
const sign=(p:Page,choice='paper')=>p.locator(`.td-choices [data-choice="${choice}"]`);
const balance=async(p:Page)=>Math.round(Number((await p.locator('[data-balance]').innerText()).replace(/[^\d,.-]/g,'').replace(',','.'))*100);
async function players(browser:Browser,audioTrace=false){
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]),[a,b]=await Promise.all(contexts.map(c=>c.newPage())),errors:string[]=[];
  if(audioTrace)await contexts[0].addInitScript(()=>{
    const trace={sources:[] as any[],visual:[] as {score:string;at:number}[],known:[] as string[]};(window as any).tsuSoundTrace=trace;
    const fingerprint=(data:Float32Array)=>{let hash=2166136261;for(let i=0;i<Math.min(128,data.length);i++)hash=Math.imul(hash^(Math.round(data[i]*1e7)|0),16777619);return data.length+':'+(hash>>>0);};(window as any).tsuSoundFingerprint=fingerprint;
    const edges=new WeakMap<AudioNode,AudioNode[]>(),connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination:any,...args:any[]){if(destination instanceof AudioNode){const list=edges.get(this)??[];list.push(destination);edges.set(this,list);}return (connect as any).call(this,destination,...args);};
    const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop,records=new WeakMap<AudioBufferSourceNode,any>();
    AudioBufferSourceNode.prototype.start=function(when=0,offset=0,duration?:number){
      if(!this.loop&&this.buffer){
        const c=this.context as AudioContext,now=performance.now(),stamp=c.getOutputTimestamp?.(),master=(window as any)[Symbol.for('royal.game-host.v1')]?.gameAudio.output;
        const seen=new WeakSet<AudioNode>(),routed=(node:AudioNode):boolean=>{if(node===master)return true;if(seen.has(node))return false;seen.add(node);return (edges.get(node)??[]).some(routed);};
        const audibleAt=stamp?.performanceTime?stamp.performanceTime+(when-stamp.contextTime!)*1000:now+(when-c.currentTime+(c.outputLatency||0)+(c.baseLatency||0))*1000;
        const row={duration:this.buffer.duration,at:now,audibleAt,routed:routed(this),cancelled:false,fingerprint:fingerprint(this.buffer.getChannelData(0))};trace.sources.push(row);records.set(this,row);
      }
      if(duration===undefined)start.call(this,when,offset);else start.call(this,when,offset,duration);
    };
    AudioBufferSourceNode.prototype.stop=function(when?:number){if(when===undefined){const row=records.get(this);if(row)row.cancelled=true;}stop.call(this,when);};
    new MutationObserver(()=>{if(document.querySelector('[data-chant]')?.textContent==='Три!'){const score=document.querySelector('.td-score')?.textContent??'';if(!trace.visual.some(row=>row.score===score))trace.visual.push({score,at:performance.now()});}}).observe(document,{subtree:true,childList:true,characterData:true});
  });
  for(const p of[a,b]){p.on('pageerror',e=>errors.push(e.message));await p.context().route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());}
  const seed=await browser.newContext(),login=await seed.request.post(base+'/api/auth/login',{data:{email:`tsu-room-${crypto.randomUUID()}@example.test`,password:'test-password!'}});
  await seed.request.post(base+'/api/auth/character',{data:{skin:0}});
  const room=await new Client(process.env.PVP_TEST_API_URL||base,{headers:{Cookie:login.headers()['set-cookie'].split(';')[0]}}).create('lobby');room.onMessage('*',()=>{});
  try{for(const[i,p]of[a,b].entries()){
    expect((await p.context().request.post(base+'/api/auth/login',{data:{email:`pvp-local-${i?'b':'a'}@example.test`,password:'test-password!'}})).ok()).toBe(true);
    await p.goto(base+'/?room='+room.roomId);await connected(p);
  }}catch(e){await Promise.all(contexts.map(c=>c.close()));throw e;}finally{await room.leave();await seed.close();}
  return{a,b,errors,close:()=>Promise.all(contexts.map(c=>c.close()))};
}
async function offer(p:Page,key=false,submit=true,stake='100000'){
  await expect.poll(()=>p.evaluate(()=>(window as any).royalDemo.getState().remotePositions.length)).toBe(1);
  if(key)await p.keyboard.press('e');else{
    const remote=await p.evaluate(()=>(window as any).royalDemo.getState().remotePositions[0]),view=await p.evaluate(()=>(window as any).royalDemo.getState().view),box=(await p.locator('#game canvas').boundingBox())!;
    await p.mouse.click(box.x+(remote.x-view.x)*view.zoom*box.width/view.width,box.y+(remote.y-24-view.y)*view.zoom*box.height/view.height,{button:'right'});
  }
  await expect(p.locator('#player-actions')).toBeVisible();await p.locator('[data-player-invite]').click();
  await expect(p.locator('[data-create]')).toBeVisible();
  await p.locator(`[data-stake-preset="${stake}"]`).click();
  if(submit)await p.locator('[data-create-button]').click();
}
async function accept(a:Page,b:Page,key=false){await offer(a,key);await expect(b.locator('#pvp-incoming')).toBeVisible();await b.locator('#pvp-incoming [data-accept]').click();for(const p of[a,b])await expect(sign(p)).toBeEnabled({timeout:25000});}
async function ready(a:Page,b:Page){for(const p of[a,b]){await expect(p.locator('.td-terms')).toHaveCount(0);await expect(sign(p)).toBeEnabled({timeout:25000});}}
async function winRound(a:Page,b:Page,wins:number){await expect(sign(a)).toBeEnabled();await sign(a).click();await expect(sign(b,'rock')).toBeEnabled();await sign(b,'rock').click();await expect(a.locator('.td-stage')).toHaveAttribute('data-stage','countdown');await expect(a.locator('.td-score')).toHaveText(`${wins-1} : 0`);await expect(a.locator('.td-score')).toHaveText(`${wins} : 0`,{timeout:10000});}
async function mobileChat(p:Page){
  const dialog=p.locator('#pvp-dialog'),chat=dialog.locator('.game-chat-dock');
  if(!await dialog.locator('.game-chat-toggle').count()){
    await expect(chat).toBeVisible();await expect(chat.locator('.chat-heading')).toContainText('Общий чат');return;
  }
  await expect(dialog).toHaveAttribute('data-game-chat','closed');
  await dialog.locator('.game-chat-toggle').click();await expect(chat).toBeVisible();await expect(chat.locator('.chat-heading')).toContainText('Общий чат');
  await chat.locator('.game-chat-close').click();await expect(chat).toBeHidden();
}

test('player menu opens one priced offer with a fixed recipient; waiting, decline and mobile chat stay simple',async({browser})=>{
  const c=await players(browser),{a,b}=c;try{
    await offer(a,false,false,'200000');await expect(b.locator('#pvp-incoming')).not.toBeVisible();
    await expect(a.locator('#pvp-title')).toHaveText('Предложить игру');await expect(a.locator('[data-recipient]')).toContainText('Борис');await expect(a.locator('[name=target]')).toBeHidden();
    await a.locator('[name=game]').selectOption('chess');await expect(a.locator('[data-duel-stakes]')).toBeHidden();await expect(a.locator('#pvp-title')).toHaveText('Предложить игру');
    await a.locator('[name=game]').selectOption('tsu-e-fa');await expect(a.locator('[data-stake-preset="200000"]')).toHaveAttribute('aria-pressed','true');
    await a.setViewportSize({width:1280,height:720});
    await a.screenshot({path:'artifacts/work/pvp-invite-simplify/offer-desktop.png'});
    await a.setViewportSize({width:390,height:844});await mobileChat(a);
    const sendBox=(await a.locator('[data-create-button]').boundingBox())!;expect(sendBox.y+sendBox.height).toBeLessThanOrEqual(844);
    await a.screenshot({path:'artifacts/work/pvp-invite-simplify/offer-mobile.png'});
    await a.locator('[data-create-button]').click();await expect(a.locator('[data-active]')).toContainText('Ждём ответа');await expect(a.locator('[data-create]')).toBeHidden();await expect(a.locator('[data-invites]')).toBeHidden();
    await expect(b.locator('#pvp-incoming')).toContainText('0,2 USDT');await expect(b.locator('#pvp-incoming [data-accept]')).toHaveText('Играть за 0,2 USDT');
    await a.screenshot({path:'artifacts/work/pvp-invite-simplify/waiting-mobile.png'});
    expect(await balance(a)).toBe(20000);await b.locator('#pvp-incoming [data-decline]').click();await expect(a.locator('[data-active]')).toContainText('Деньги не списаны');expect(await balance(a)).toBe(20000);
    await a.locator('#pvp-dialog [data-close]').click();await offer(a,true);await expect(b.locator('#pvp-incoming')).toBeVisible();
    await a.locator('[data-pvp-action="cancel"]').click();await expect(b.locator('#pvp-incoming')).toBeHidden();expect(await balance(a)).toBe(20000);expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

test('another game uses the same fixed recipient and its own name in the outgoing and incoming offer',async({browser})=>{
  const c=await players(browser),{a,b}=c;try{
    await offer(a,false,false);const before=await balance(a);
    await a.locator('[name=game]').selectOption('chess');await a.locator('[name=stake]').fill('1');
    await expect(a.locator('[name=target]')).toBeHidden();await a.locator('[data-create-button]').click();
    await expect(a.locator('[data-active]')).toContainText('Шахматы');await expect(a.locator('[data-create]')).toBeHidden();
    await expect(b.locator('#pvp-incoming-title')).toHaveText('Шахматы');await expect(b.locator('#pvp-incoming')).toContainText('1 USDT');
    expect(await balance(a)).toBe(before-100);await b.locator('#pvp-incoming [data-decline]').click();
    await expect(a.locator('[data-active]')).toContainText('Средства возвращены');expect(await balance(a)).toBe(before);expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

test('ten-cent best-of-three match uses secret choices, synchronized reveal, two wins, exact single credit, mobile chat and recovery',async({browser})=>{
  const c=await players(browser),{a,b}=c;try{
    await offer(a,false,false);const beforeA=await balance(a);await a.locator('[data-create-button]').click();await expect(b.locator('#pvp-incoming')).toBeVisible();await b.locator('#pvp-incoming [data-accept]').click();await ready(a,b);const beforeB=(await balance(b))+10;expect(await balance(a)).toBe(beforeA-10);
    await sign(a).click();await expect(a.locator('.td-status')).toContainText('Твой знак закрыт');await expect(b.locator('.td-stage')).toHaveAttribute('data-stage','select');await expect(b.locator('.td-score')).toHaveText('0 : 0');
    await a.reload();await connected(a);await expect(a.locator('#pvp-dialog')).toBeVisible();await expect(sign(a)).toHaveAttribute('aria-pressed','true');await expect(sign(b,'rock')).toBeEnabled();await sign(b,'rock').click();await expect(a.locator('.td-stage')).toHaveAttribute('data-stage','countdown');await expect(a.locator('.td-score')).toHaveText('1 : 0',{timeout:10000});
    await a.screenshot({path:'artifacts/work/tsu-v3-desktop.png'});await a.setViewportSize({width:390,height:844});
    await mobileChat(a);const boxes=await a.locator('.td-choices button').evaluateAll(buttons=>buttons.map(button=>{const b=button.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};}));expect(boxes).toHaveLength(3);for(const box of boxes){expect(box.width).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(844);}
    await a.screenshot({path:'artifacts/work/tsu-v3-mobile.png'});await expect(a.locator('.td-status')).not.toContainText('Ты победил');await winRound(a,b,2);
    await expect(a.locator('.td-status')).toContainText('Начислено 0,19 USDT');expect(await balance(a)).toBe(beforeA+9);expect(await balance(b)).toBe(beforeB-10);
    await a.locator('#pvp-dialog [data-close]').click();if(!await a.locator('#pvp-button').isVisible())await a.locator('.profile-toggle').click();await a.locator('#pvp-button').click();await expect(a.locator('.td-score')).toHaveText('2 : 0');await expect(a.locator('[data-chant]')).toHaveText('');expect(await balance(a)).toBe(beforeA+9);expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

test('real lost connection freezes selection and countdown; reconnect resumes the locked choice and surrender confirms once',async({browser})=>{
  const c=await players(browser),b=c.b;let a=c.a;try{
    await accept(a,b);const beforeA=(await balance(a))+10,beforeB=(await balance(b))+10;await ready(a,b);await sign(a).click();await expect(sign(a)).toHaveAttribute('aria-pressed','true');const url=a.url();
    await a.context().setOffline(true);await a.reload().catch(()=>{});await expect(b.locator('.td-pause')).toBeVisible({timeout:15000});await expect(sign(b)).toBeDisabled();
    await a.context().setOffline(false);const recovered=await a.context().newPage();recovered.on('pageerror',e=>c.errors.push(e.message));await a.close();a=recovered;await a.goto(base+'/');await connected(a);await expect(sign(a)).toHaveAttribute('aria-pressed','true');await expect(sign(b,'rock')).toBeEnabled();await sign(b,'rock').click();await expect(b.locator('.td-stage')).toHaveAttribute('data-stage','countdown');
    await a.context().setOffline(true);await a.reload().catch(()=>{});await expect(b.locator('.td-pause')).toBeVisible({timeout:15000});await b.waitForTimeout(4500);await expect(b.locator('.td-score')).toHaveText('0 : 0');
    await a.context().setOffline(false);await a.goto(url);await connected(a);await expect(b.locator('.td-pause')).toHaveCount(0);await expect(a.locator('.td-score')).toHaveText('1 : 0',{timeout:12000});expect(await balance(a)).toBe(beforeA-10);
    await a.locator('[data-exit]').click();await expect(a.locator('.td-confirm')).toBeVisible();await a.locator('[data-continue]').click();await expect(a.locator('.td-confirm')).toHaveCount(0);await a.locator('[data-exit]').click();await a.locator('[data-confirm-exit]').click();
    await expect(b.locator('.td-status')).toContainText('Начислено 0,19 USDT');expect(await balance(b)).toBe(beforeB+9);expect(await balance(a)).toBe(beforeA-10);expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

test('final settlement closes an unconfirmed surrender dialog',async({browser})=>{
  const c=await players(browser),{a,b}=c;try{
    await accept(a,b);await ready(a,b);await winRound(a,b,1);
    await expect(sign(a)).toBeEnabled();await sign(a).click();await sign(b,'rock').click();
    await expect(a.locator('.td-stage')).toHaveAttribute('data-stage','countdown');
    await a.locator('[data-exit]').click();await expect(a.locator('.td-confirm')).toBeVisible();
    await expect(a.locator('.td-score')).toHaveText('2 : 0',{timeout:10000});
    await expect(a.locator('.td-status')).toContainText('Начислено 0,19 USDT');
    await expect(a.locator('.td-confirm')).toHaveCount(0);
    await expect(a.locator('[data-confirm-exit]')).toHaveCount(0);
    expect(c.errors).toEqual([]);
  }finally{await c.close();}
});

test('hand-duel sounds reach Royal output, follow the reveal and stay quiet after mute and reopening',async({browser})=>{
  const c=await players(browser,true),{a,b}=c;try{
    await accept(a,b);
    const rate=await a.evaluate(()=>(window as any)[Symbol.for('royal.game-host.v1')].gameAudio.context.sampleRate);
    const cues:TsuCue[]=['lock','ready','beat','reveal','draw','round-win','round-lose','match-win','match-lose'];
    const known=cues.flatMap(cue=>(cue==='beat'?[0,1,2,3,4]:[0]).map(variant=>{const data=renderTsuCue(cue,rate,variant);let hash=2166136261;for(let i=0;i<Math.min(128,data.length);i++)hash=Math.imul(hash^(Math.round(data[i]*1e7)|0),16777619);return data.length+':'+(hash>>>0);}));
    await a.evaluate(known=>{(window as any).tsuSoundTrace.known=known;},known);
    await ready(a,b);await winRound(a,b,1);await expect(sign(a)).toBeEnabled();
    const owned=()=>a.evaluate(()=>{const t=(window as any).tsuSoundTrace;return t.sources.filter((row:any)=>t.known.includes(row.fingerprint));});
    const trace={sources:await owned(),visual:await a.evaluate(()=>(window as any).tsuSoundTrace.visual)};
    const beats=trace.sources.filter((row:any)=>Math.abs(row.duration-.13)<.001),reveals=trace.sources.filter((row:any)=>Math.abs(row.duration-.19)<.001);
    expect(beats.length).toBeGreaterThanOrEqual(4);expect(beats.length).toBeLessThanOrEqual(5);expect(reveals).toHaveLength(1);
    expect(beats.every((row:any)=>row.routed)).toBe(true);expect(reveals[0].routed).toBe(true);
    const visual=trace.visual.find((row:any)=>row.score==='1 : 0');expect(visual).toBeTruthy();expect(Math.abs(visual.at-reveals[0].audibleAt)).toBeLessThan(80);
    await a.locator('[data-sound]').click();expect(await a.evaluate(()=>(window as any).royalDemo.getAudio().muted)).toBe(true);
    const before=(await owned()).length;
    await winRound(a,b,2);await expect(a.locator('.td-status')).toContainText('Начислено 0,19 USDT');
    expect((await owned()).length).toBe(before);
    await a.locator('[data-sound]').click();await a.waitForTimeout(200);expect((await owned()).length).toBe(before);
    await a.locator('#pvp-dialog [data-close]').click();if(!await a.locator('#pvp-button').isVisible())await a.locator('.profile-toggle').click();await a.locator('#pvp-button').click();
    await expect(a.locator('.td-score')).toHaveText('2 : 0');expect((await owned()).length).toBe(before);expect(c.errors).toEqual([]);
    await mkdir('artifacts/work/tsu-sound',{recursive:true});await writeFile('artifacts/work/tsu-sound/timing.json',JSON.stringify({beats:beats.length,reveals:reveals.length,estimatedRevealSkewMs:visual.at-reveals[0].audibleAt,masterOutputVerified:true,muteAndReopenQuiet:true,scope:'Browser output-clock estimate and rendered frame, not acoustic latency or subjective listening quality.'},null,2));
  }finally{await c.close();}
});
