import {test,expect,type Page} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {selectHall} from './room-ui';

const net=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getNetworkState());
const activities=(page:Page)=>page.evaluate(()=>(window as any).royalDemo.getActivities());
async function join(page:Page,room:string){
  await page.context().request.post('/api/auth/login',{data:{email:`sync-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
  await page.context().request.post('/api/auth/character',{data:{skin:0}});await page.goto('/?room='+room);
  await expect.poll(async()=>(await net(page)).status).toBe('connected');
}
async function open(page:Page,id:string){
  await selectHall(page,'tables');await page.locator('#games-tab').click();await page.locator(`[data-activity="${id}"]`).click();
  await expect(page.locator('#shared-dialog')).toBeVisible({timeout:15000});
}

test('table traffic stays in its hall and reconnect replaces missed game state before resuming patches',async({browser,request})=>{
  test.setTimeout(120000);
  const login=await request.post('/api/auth/login',{data:{email:`sync-host-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
  expect(login.ok()).toBe(true);await request.post('/api/auth/character',{data:{skin:0}});
  const host=await new Client(process.env.ROYAL_TEST_SERVER_URL||process.env.TEST_BASE_URL||'http://127.0.0.1:2567',{headers:{Cookie:login.headers()['set-cookie'].split(';')[0]}}).create<any>('lobby',{activityProtocol:1});
  const updates:any[]=[];host.onMessage('activities',value=>updates.push(value));
  for(const type of ['chat','piano-note','notice'])host.onMessage(type,()=>{});
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));const errors:string[]=[];
  for(const page of [a,b])page.on('pageerror',error=>errors.push(error.message));
  try{
    await join(a,host.roomId);await join(b,host.roomId);const aid=(await net(a)).selfId,before=await net(b);
    await open(a,'chess');await open(b,'chess');await expect.poll(async()=>(await activities(a)).chess.players.length).toBe(2);
    expect(updates).toEqual([]);
    await contexts[1].setOffline(true);await expect.poll(async()=>(await net(b)).status,{timeout:20000}).toBe('reconnecting');
    await expect.poll(async()=>(await activities(a)).chess.players).toEqual([aid]);
    await a.locator('#shared-close').click();await open(a,'pool');
    await expect.poll(async()=>(await activities(a)).tables[1].players).toEqual([aid]);
    await contexts[1].setOffline(false);await expect.poll(async()=>(await net(b)).status,{timeout:15000}).toBe('connected');
    expect((await net(b)).selfId).toBe(before.selfId);
    await expect.poll(async()=>(await activities(b)).tables[1].players).toEqual([aid]);
    await expect.poll(async()=>(await activities(b)).chess.players).toEqual([]);
    await open(b,'pool');await expect(a.locator('#pool-shoot')).toBeEnabled();
    await a.locator('#pool-shoot').click();await expect.poll(async()=>(await activities(b)).tables[1].moving).toBe(true);
    expect(updates).toEqual([]);
    // An observer entering the games hall must receive the frames missed in the arcade.
    host.send('target',{x:900,y:240,revision:0});
    await expect.poll(()=>host.state.players.get(host.sessionId)?.hall,{timeout:15000}).toBe('tables');
    await expect.poll(()=>updates.some(value=>!value.patch&&value.tables[1].players.length===2)).toBe(true);
    await b.locator('#shared-close').click();
    await expect.poll(()=>updates.some(value=>value.patch&&value.tables?.some((table:any)=>table.id==='pool'&&table.players?.length===1))).toBe(true);
    expect(errors).toEqual([]);
  }finally{
    await Promise.all(contexts.map(c=>c.close()));host.reconnection.enabled=false;host.connection.close(1000);await request.post('/api/auth/logout');
  }
});
