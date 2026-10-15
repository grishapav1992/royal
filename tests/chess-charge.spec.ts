import {selectHall} from './room-ui';
import {test,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
const activities=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getActivities());
const net=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getNetworkState());
async function join(page:Page,room:string){
 const login=await page.context().request.post('/api/auth/login',{data:{email:`chess-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(login.ok()).toBe(true);await page.context().request.post('/api/auth/character',{data:{skin:0}});await page.goto('/?room='+room);await expect.poll(async()=>(await net(page))?.status).toBe('connected');
}
async function open(page:Page,id:string){await selectHall(page,id==='piano'?'arcade':'tables');await page.locator('#games-tab').click();await page.locator(`[data-activity="${id}"]`).click();await expect(page.locator('#shared-dialog')).toBeVisible({timeout:15000});}
async function close(page:Page){await page.locator('#shared-close').click();await expect(page.locator('#shared-dialog')).toBeHidden();}
async function move(page:Page,from:string,to:string){await page.locator(`[data-square="${from}"]`).click();await expect(page.locator(`[data-square="${to}"]`)).toHaveClass(/legal/);await page.locator(`[data-square="${to}"]`).click();await expect.poll(async()=>(await activities(page)).chess.last).toEqual({from,to});}
test('Space charges pool only until release; two players play chess with spectators, mate and rematch',async({browser,request})=>{
 test.setTimeout(200000);
 const login=await request.post('/api/auth/login',{data:{email:`host-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});expect(login.ok()).toBe(true);
 const cookie=login.headers()['set-cookie'].split(';')[0];await request.post('/api/auth/character',{data:{skin:0}});
 const host=await new Client(process.env.TEST_BASE_URL||'http://127.0.0.1:2567',{headers:{Cookie:cookie}}).create('lobby');for(const type of ['chat','activities','piano-note'])host.onMessage(type,()=>{});
 const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);const [a,b,c]=await Promise.all(contexts.map(c=>c.newPage()));const errors:string[]=[];for(const p of [a,b,c])p.on('pageerror',e=>errors.push(e.message));
 try{
  await join(a,host.roomId);await join(b,host.roomId);const aid=(await net(a)).selfId,bid=(await net(b)).selfId;
  await open(a,'pool');await open(b,'pool');await expect(a.locator('#pool-shoot')).toBeEnabled();
  await b.keyboard.down('Space');await b.waitForTimeout(200);await b.keyboard.up('Space');expect((await activities(b)).charge.charging).toBe(false);expect((await activities(a)).tables[1].moving).toBe(false);
  await a.locator('#shared-canvas').focus();await a.keyboard.down('Space');await expect.poll(async()=>(await activities(a)).charge.power).toBeGreaterThan(150);
  await a.evaluate(()=>window.dispatchEvent(new Event('blur')));await a.keyboard.up('Space');expect((await activities(a)).charge.charging).toBe(false);expect((await activities(b)).tables[1].moving).toBe(false);
  await a.keyboard.down('Space');await expect.poll(async()=>(await activities(a)).charge.power).toBe(850);expect((await activities(a)).tables[1].moving).toBe(false);await a.waitForTimeout(250);expect((await activities(a)).charge.charging).toBe(true);
  await a.screenshot({path:'artifacts/pool-charge.png'});await a.keyboard.up('Space');await expect.poll(async()=>(await activities(b)).tables[1].moving).toBe(true);
  expect((await activities(a)).charge.charging).toBe(false);await close(a);await close(b);
  await open(a,'pool');await open(b,'pool');await expect(a.locator('#pool-shoot')).toBeEnabled();await a.locator('#shared-canvas').focus();await a.keyboard.down('Space');await a.waitForTimeout(100);await a.keyboard.up('Space');
  expect((await activities(a)).charge.power).toBeLessThan(300);await expect.poll(async()=>(await activities(b)).tables[1].moving).toBe(true);await close(a);await close(b);
  await open(a,'chess');await expect(a.locator('#shared-status')).toContainText('Ждём второго');await expect(a.locator('.chess-clock strong')).toHaveText(['15:00','15:00']);await a.waitForTimeout(1100);expect((await activities(a)).chess.clock.remainingMs).toEqual([900000,900000]);await open(b,'chess');await expect.poll(async()=>(await activities(a)).chess.players).toEqual([aid,bid]);
  await expect(a.locator('.chess-clock[data-color="w"]')).toHaveClass(/running/);await expect.poll(async()=>(await activities(a)).chess.clock.remainingMs[0]).toBeLessThan(899000);expect((await activities(b)).chess.clock.remainingMs[1]).toBe(900000);
  await expect(a.locator('.chess-square')).toHaveCount(64);await expect(b.locator('.chess-square').first()).toHaveAttribute('data-square','h1');
  await join(c,host.roomId);await open(c,'chess');await expect(c.locator('#shared-status')).toContainText('Ты наблюдаешь');await expect(c.locator('[data-square="e2"]')).toBeDisabled();
  await a.locator('[data-square="e2"]').click();await expect(a.locator('[data-square="e4"]')).toHaveClass(/legal/);await a.waitForTimeout(1200);await expect(a.locator('[data-square="e4"]')).toHaveClass(/legal/);await a.locator('[data-square="e5"]').click();expect((await activities(a)).chess.last).toBeNull();
  await move(a,'f2','f3');await expect.poll(()=>a.evaluate(()=>(window as any).royalDemo.getAudio().table.played['chess:hit']||0)).toBeGreaterThan(0);
  await expect(a.locator('.chess-square svg.chess-piece')).toHaveCount(32);await expect(a.locator('.chess-clock[data-color="b"]')).toHaveClass(/running/);
  const whiteTime=(await activities(a)).chess.clock.remainingMs[0];
  await expect(a.locator('.chess-clock[data-color="b"] strong')).not.toHaveText('15:00');
  // Clock corrections arrive once a second; assert the next sample instead of its arrival phase.
  await expect.poll(async()=>(await activities(a)).chess.clock.remainingMs[1]).toBeLessThan(899000);
  expect((await activities(a)).chess.clock.remainingMs[0]).toBe(whiteTime);
  await expect.poll(async()=>(await activities(c)).chess.last).toEqual({from:'f2',to:'f3'});await move(b,'e7','e5');await move(a,'g2','g4');await move(b,'d8','h4');
  await expect(a.locator('#shared-status')).toContainText('Мат');await expect.poll(async()=>(await activities(c)).chess.winner).toBe(bid);await a.screenshot({path:'artifacts/chess-mate.png'});
  const stopped=(await activities(a)).chess.clock.remainingMs;await a.waitForTimeout(1100);expect((await activities(a)).chess.clock.remainingMs).toEqual(stopped);await expect(a.locator('.chess-clock.running')).toHaveCount(0);
  await a.locator('#shared-rematch').click();await expect(a.locator('#shared-rematch')).toBeDisabled();await b.locator('#shared-rematch').click();await expect.poll(async()=>(await activities(a)).chess.players).toEqual([bid,aid]);await move(b,'e2','e4');
  await a.setViewportSize({width:390,height:844});expect(await a.locator('#shared-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await a.screenshot({path:'artifacts/chess-mobile.png'});
  await a.getByRole('button',{name:'Сдаться',exact:true}).click();await expect(b.locator('#shared-status')).toContainText('Соперник сдался');
  await close(a);await expect.poll(async()=>(await activities(b)).chess.players).toEqual([bid,(await net(c)).selfId]);await expect(c.locator('#shared-status')).not.toContainText('Ты наблюдаешь');
  await close(b);await close(c);expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));host.reconnection.enabled=false;host.connection.close(1000);await request.post('/api/auth/logout');}
});
