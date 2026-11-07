import { test, expect, type Page } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { ROOM_CHAT_PROTOCOL, type ChatVisit } from '../src/shared/chat';
import { elevatorDock } from '../src/shared/elevator';
const password = 'Chat-overlay-isolated-test-123!';
const proofDir = process.env.CHAT_PROOF_DIR || 'artifacts/chat-over-games-20261015';
async function login(page: Page, room: string) {
  const response = await page.request.post('/api/auth/login', {data:{email:`chat-overlay-${crypto.randomUUID()}@example.test`,password}});
  expect(response.ok()).toBe(true);
  expect((await page.request.post('/api/auth/character',{data:{skin:0}})).ok()).toBe(true);
  await page.goto('/?room='+room,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#loading')).toHaveCount(0);
  await expect(page.locator('#join-dialog')).toBeHidden({timeout:30000});
  await expect(page.locator('#chat-input')).toBeEnabled();
}
async function openGame(page:Page, id:string, hall='arcade') {
  await page.bringToFront();
  if (hall !== 'arcade') { for (const target of ['tables',hall]) { await page.locator(`[data-floor-target=${target}]`).click(); await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().hall),{timeout:30000}).toBe(target); } }
  await page.locator('#games-tab').click();
  const cabinet = page.locator(`[data-cabinet="${id}"],[data-studio="${id}"],[data-card-table="${id}"]`).first();
  await cabinet.focus(); await expect(cabinet).toBeFocused(); await page.keyboard.press('Enter');
  try { await expect(page.locator('#mini-dialog')).toBeVisible({timeout:30000}); } catch (error) {
    console.log('Entry diagnostic',JSON.stringify(await page.evaluate(()=>({state:(window as any).royalDemo.getState(),network:(window as any).royalDemo.getNetworkState(),active:document.activeElement?.id}))));
    await page.screenshot({path:proofDir+'/entry-failure.png'});throw error;
  }
  await expect(page.locator('#mini-message')).toBeHidden({timeout:30000});
}
test('connected chat sends and receives over slots and dealer games, restores one shared composer',async({page,request})=>{
  test.setTimeout(process.env.TEST_BASE_URL ? 180000 : 90000);
  page.setDefaultTimeout(process.env.TEST_BASE_URL ? 30000 : 15000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const auth=await request.post('/api/auth/login',{data:{email:`chat-observer-${crypto.randomUUID()}@example.test`,password}});
  expect(auth.ok()).toBe(true); await request.post('/api/auth/character',{data:{skin:0}});
  const cookie=auth.headers()['set-cookie'].split(';')[0];
  const host=await new Client(process.env.TEST_BASE_URL || 'http://127.0.0.1:2567',{headers:{Cookie:cookie}}).create('lobby');
  const received:string[]=[];
  let hostVisit: ChatVisit | null = null;
  host.onMessage('*',()=>{});
  host.onMessage('chat',m=>received.push(m.text));
  host.onMessage('chat-visit',value=>{hostVisit=value;});
  host.send('history',{version:ROOM_CHAT_PROTOCOL});
  try {
    await expect.poll(()=>hostVisit?.hall).toBe('arcade');
    await login(page,host.roomId);
    await page.locator('#chat-input').fill('Сохранённый черновик');
    for(const [id,hall] of [[process.env.CHAT_SLOT || 'royal-fruits','arcade'],['github-baccarat','github']]) {
      if (hall === 'github') {
        const player = () => host.state.players.get(host.sessionId);
        const entry = elevatorDock('arcade').entry;
        host.send('target', { ...entry, revision: player().hallRevision });
        await expect.poll(() => Math.hypot(player().x - entry.x, player().y - entry.y), { timeout: 20000 }).toBeLessThan(40);
        host.send('elevator', { target: hall, requestId: 1, revision: player().hallRevision });
        await expect.poll(()=>hostVisit?.hall).toBe(hall);
      }
      console.log('Opening',id);await openGame(page,id,hall);console.log('Opened',id);
      const toggle=page.getByRole('button',{name:'Общий чат',exact:true});
      await expect(toggle).toBeVisible(); await expect(page.locator('#mini-dialog #chat-panel')).toBeHidden();
      await toggle.click(); await expect(page.locator('#chat-input')).toBeFocused();
      await expect(page.locator('#chat-input')).toHaveValue('Сохранённый черновик');
      for (const viewport of [{width:1366,height:768},{width:390,height:844},{width:844,height:390}]) {
        console.log('Chat viewport',id,viewport.width);await page.setViewportSize(viewport);
        if(process.env.TEST_BASE_URL && viewport.width!==1366){await expect(page.locator('#chat-input')).toBeInViewport();continue;}
        const message=`Игра ${id}, экран ${viewport.width}`;
        await expect(page.locator('#chat-input')).toBeInViewport();
        await page.locator('#chat-input').fill(message);
        await page.keyboard.press('Enter');
        await expect(page.locator('#chat-log')).toContainText(message,{timeout:20000});
        await expect.poll(()=>received.includes(message),{timeout:20000}).toBe(true);
        const reply=`Ответ ${id} ${viewport.width}`; host.send('chat',{id:crypto.randomUUID(),text:reply,visitId:hostVisit?.id});
        await expect(page.locator('#chat-log')).toContainText(reply,{timeout:20000});
        await expect(page.locator('#mini-dialog')).toBeVisible();
        await page.waitForTimeout(700);
      }
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--app-height')==='844px');
      await page.evaluate(()=>document.documentElement.style.setProperty('--app-height','420px'));
      await expect(page.locator('#chat-input')).toBeInViewport();
      const input=await page.locator('#chat-input').boundingBox(); expect(input!.y+input!.height).toBeLessThan(420);
      await page.evaluate(()=>document.documentElement.style.removeProperty('--app-height'));
      await page.locator('#chat-input').fill('Сохранённый черновик');
      await page.keyboard.press('Escape');
      await expect(page.locator('#mini-dialog')).toBeVisible(); await expect(toggle).toBeFocused();
      await expect(page.locator('#mini-dialog #chat-panel')).toBeHidden();
      await toggle.click();await expect(page.locator('#chat-input')).toHaveValue('Сохранённый черновик');
      await page.screenshot({path:`${proofDir}/${id}-mobile.png`});
      await page.locator('.mini-top [data-close]').click();
      await expect.poll(()=>page.evaluate(()=>(window as any).royalDemo.getState().cabinet),{timeout:10000}).toBe('');
      await expect(page.locator('.workspace #chat-panel')).toBeVisible();
      await expect(page.locator('#chat-input')).toHaveCount(1);
      await expect(page.locator('#chat-input')).toHaveValue('Сохранённый черновик');
      await page.setViewportSize({width:1366,height:768});
    }
    expect(errors).toEqual([]);
  } finally {await Promise.race([host.leave(),new Promise(resolve=>setTimeout(resolve,3000))]);await Promise.allSettled([page.request.post('/api/auth/logout',{timeout:3000}),request.post('/api/auth/logout',{timeout:3000})]);}
});
