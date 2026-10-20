import {worldPoint,showChat} from './room-ui';
import { test, expect, type Page } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { diagonalTrace } from './diagonal';
const net = (page: Page) => page.evaluate(() => (window as any).royalDemo.getNetworkState());
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
const password = 'Royal-demo-123!';
const email = () => 'test-' + crypto.randomUUID() + '@example.test';

test('keyboard starts and stops locally with 600 ms of added WebSocket round trip', async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  try {
    const a = await ca.newPage(), b = await cb.newPage();
    // Delay real binary WebSocket traffic without changing positions or game input.
    await a.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      (window as any).__socketDelay = 0;
      window.WebSocket = class extends NativeWebSocket {
        private handler: ((event: MessageEvent) => void) | null = null;
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          super.addEventListener('message', event => {
            const delay = (window as any).__socketDelay;
            if (delay) setTimeout(() => this.handler?.call(this, event), delay);
            else this.handler?.call(this, event);
          });
        }
        get onmessage() { return this.handler; }
        set onmessage(handler) { this.handler = handler; }
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          const copy = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() : data instanceof ArrayBuffer ? data.slice(0) : data;
          const delay = (window as any).__socketDelay;
          if (delay) setTimeout(() => { if (this.readyState === NativeWebSocket.OPEN) super.send(copy); }, delay);
          else super.send(copy);
        }
      };
    });
    await join(a, 'Быстрый отклик');
    await join(b, 'Наблюдатель', `/?room=${(await net(a)).roomId}`);
    const id = (await net(a)).selfId;
    await expect.poll(async () => (await state(a)).serverX).toBeDefined();
    const before = await state(a); await a.evaluate(() => { (window as any).__socketDelay = 300; });
    await a.keyboard.down('d');
    await a.waitForFunction(x => (window as any).royalDemo.getState().x > x+2, before.x, { timeout: 220 });
    expect((await state(a)).serverX).toBe(before.serverX);
    await a.waitForTimeout(250);
    await a.keyboard.up('d');
    await a.waitForFunction(() => !(window as any).royalDemo.getState().moving, undefined, { timeout: 220 });
    const stopped = await state(a);
    await a.waitForTimeout(900);
    const settled = await state(a);
    expect(Math.abs(settled.x-stopped.x)).toBeLessThan(2);
    expect(Math.abs(settled.x-settled.serverX)).toBeLessThan(.5);
    expect(settled.pendingInputs).toBe(0);
    await expect.poll(async () => Math.abs((await state(b)).remotePositions.find((p: any) => p.id === id).x-settled.x)).toBeLessThan(1);
    await a.keyboard.down('a');
    await a.waitForFunction(x => (window as any).royalDemo.getState().x < x-2, settled.x, { timeout: 220 });
    await a.keyboard.up('a');
    await a.waitForTimeout(900);
    expect((await state(a)).pendingInputs).toBe(0);
  } finally { await ca.close(); await cb.close(); }
});

test('diagonal facing and walk cycle remain stable for the player and observer', async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  try {
    const a = await ca.newPage(), b = await cb.newPage();
    await join(a, 'Диагональ');
    await join(b, 'Наблюдатель', `/?room=${(await net(a)).roomId}`);
    const id = (await net(a)).selfId;
    await expect.poll(async () => (await state(b)).remotePositions.some((p: any) => p.id === id)).toBe(true);
    for (const keys of [['s','d'], ['w','a'], ['s','a'], ['w','d']]) {
      for (const key of keys) await a.keyboard.down(key);
      const walking = new RegExp(`^(${keys[0] === 's' ? 'down' : 'up'}|${keys[1] === 'd' ? 'right' : 'left'})-[0-5]$`);
      await expect.poll(async () => walking.test((await state(a)).frame) && walking.test((await state(b)).remotePositions.find((p: any) => p.id === id)?.frame), { intervals: [20] }).toBe(true);
      const traces = await Promise.all([diagonalTrace(a, undefined, 300), diagonalTrace(b, id, 300)]);
      for (const key of keys) await a.keyboard.up(key);
      for (const trace of traces) {
        expect(new Set(trace.map(s => s.facing)).size, JSON.stringify({ keys, trace })).toBe(1);
        expect(new Set(trace.map(s => s.frame)).size).toBeGreaterThanOrEqual(2);
        expect(Math.abs(trace.at(-1)!.x-trace[0].x)).toBeGreaterThan(15);
        expect(Math.abs(trace.at(-1)!.y-trace[0].y)).toBeGreaterThan(15);
      }
      expect(traces[0][0].facing).toBe(traces[1][0].facing);
      await expect.poll(async () => (await state(a)).moving).toBe(false);
      await expect.poll(async () => (await state(b)).remotePositions.find((p: any) => p.id === id)?.frame).toMatch(/-[6-9]$/);
    }
  } finally { await ca.close(); await cb.close(); }
});
async function join(page: Page, _name: string, url = '/', skin = 'Эдди') {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.getByLabel('Почта', {exact:true}).fill(email());
  await page.getByLabel('Пароль', {exact:true}).pressSequentially(password);
  await expect(page.getByLabel('Пароль', {exact:true})).toHaveValue(password);
  await page.getByRole('button', { name: 'Продолжить', exact:true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.locator('#character-selection').getByRole('button', { name: skin, exact: true }).click();
  const alias = await page.locator('#account-name').textContent();
  if ((page.viewportSize()?.width || 1440) < 500) await page.screenshot({path:'artifacts/character-picker-mobile.png'});
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).not.toBeVisible();
  await expect.poll(async () => (await net(page))?.status).toBe('connected');
  return alias!;
}

test('two guests share movement, chat, typing focus and mini-game presence', async ({ browser }) => {
  const firstContext = await browser.newContext(); const secondContext = await browser.newContext();
  const a = await firstContext.newPage(), b = await secondContext.newPage();
  const errors: string[] = []; for (const page of [a,b]) page.on('pageerror', error => errors.push(error.message));
  const anna = await join(a, 'Тест Анна', '/', 'Лиззи');
  const roomId = (await net(a)).roomId;
  const boris = await join(b, 'Тест Борис', `/?room=${roomId}`);
  await expect(a.locator('#people-list')).toContainText(boris);
  await expect(b.locator('#people-list')).toContainText(anna);
  await expect.poll(async () => (await state(a)).remotes).toBeGreaterThanOrEqual(1);
  expect((await state(a)).skin).toBe(1);
  expect((await state(a)).texture).toBe('citizen-1');
  const before = await state(a);
  await a.keyboard.down('ArrowRight'); await a.waitForTimeout(450); await a.keyboard.up('ArrowRight');
  await expect.poll(async () => (await state(a)).x).toBeGreaterThan(before.x + 30);
  const selfId = (await net(a)).selfId;
  await expect.poll(async () => (await state(b)).remotePositions.find((p: { id: string }) => p.id === selfId)?.x).toBeGreaterThan(before.x + 30);
  await showChat(a);await a.getByLabel('Сообщение в общий чат').fill('Привет! WASD <b>не HTML</b>');
  await a.keyboard.press('Enter');
  await expect(b.locator('#chat-log')).toContainText('Привет! WASD <b>не HTML</b>');
  expect(await b.locator('#chat-log b').count()).toBe(0);
  await expect.poll(async () => (await state(a)).moving).toBe(false);
  // Allow the final server position to interpolate before measuring typing.
  await a.waitForTimeout(250);
  const stopped = await state(a);
  await a.getByLabel('Сообщение в общий чат').pressSequentially('wasd');
  await a.waitForTimeout(300);
  expect(Math.abs((await state(a)).x - stopped.x)).toBeLessThan(3);
  await a.keyboard.press('Escape');
  await a.locator('#games-tab').click();
  await a.locator('[data-cabinet="royal-coins"]').click();
  await expect(a.locator('#mini-dialog')).toBeVisible({ timeout: 15000 });
  await expect(b.locator('#people-list')).toContainText(anna + ' · 01 · играет');
  await a.keyboard.press('Escape');
  await expect(b.locator('#people-list')).not.toContainText('играет');
  await a.goto('/?offline=1');
  await expect(b.locator('#people-list')).not.toContainText(anna);
  expect(errors).toEqual([]);
  await firstContext.close(); await secondContext.close();
});

test('mobile guest can chat and recover after a brief network interruption', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await join(page, 'Мобильный гость');
  const before = await net(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await showChat(page);await page.getByLabel('Сообщение в общий чат').fill('С телефона тоже работает');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).tap();
  await expect(page.locator('#chat-log')).toContainText('С телефона тоже работает');
  await page.screenshot({ path: 'artifacts/online-mobile.png', fullPage: true });
  await context.setOffline(true);
  await expect.poll(async () => (await net(page)).status, { timeout: 20000 }).toBe('reconnecting');
  await context.setOffline(false);
  await expect.poll(async () => (await net(page)).status, { timeout: 15000 }).toBe('connected');
  expect((await net(page)).selfId).toBe(before.selfId);
  expect((await net(page)).roomId).toBe(before.roomId);
  await showChat(page);await page.getByLabel('Сообщение в общий чат').fill('Связь восстановлена');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).tap();
  await expect(page.locator('#chat-log')).toContainText('Связь восстановлена');
  await context.close();
});

test('account login, saved character, wrong password, logout and expired invitation', async ({page, context}) => {
  const address = email();
  await page.goto('/');
  await page.getByLabel('Почта', {exact:true}).fill(address);
  await page.getByLabel('Пароль', {exact:true}).fill(password);
  await page.getByRole('button', {name:'Продолжить',exact:true}).click();
  await page.locator('#character-selection').getByRole('button', { name: 'Гас', exact: true }).click();
  await page.screenshot({path:'artifacts/character-picker.png'});
  await page.getByRole('button', {name:'Войти в зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).not.toBeVisible();
  await expect.poll(async () => (await state(page)).skin).toBe(12);
  expect(await page.evaluate(() => document.cookie)).not.toContain('royal_session');
  const cookies = await context.cookies();
  expect(cookies.find(c=>c.name==='royal_session')?.httpOnly).toBe(true);
  const duplicate = await context.newPage();
  try {
    await duplicate.goto(page.url(), {waitUntil:'domcontentloaded'});
    await expect(duplicate.locator('#join-error')).toContainText('уже находится');
    expect((await context.request.get('/healthz')).ok()).toBe(true);
    expect((await net(page)).status).toBe('connected');
  } finally { await duplicate.close(); }
  await page.reload({waitUntil:'domcontentloaded'});
  await expect.poll(async () => (await net(page)).status).toBe('connected');
  await expect(page.locator('#join-dialog')).not.toBeVisible();
  await expect.poll(async () => (await state(page)).skin).toBe(12);
  await page.route('**/matchmake/joinById/**', route => route.fulfill({status:522,contentType:'application/json',body:JSON.stringify({code:522,error:'room has been disposed'})}), {times:1});
  await page.reload({waitUntil:'domcontentloaded'});
  await expect.poll(async () => (await net(page)).status).toBe('connected');
  await expect(page.locator('#join-dialog')).not.toBeVisible();
  await page.getByRole('button', {name:'Выйти',exact:true}).click();
  await expect(page.getByLabel('Почта',{exact:true})).toBeVisible();
  expect((await context.request.get('/api/auth/me').then(r=>r.json())).account).toBeNull();
  await page.getByLabel('Почта',{exact:true}).fill(address.toUpperCase());
  await page.getByLabel('Пароль',{exact:true}).fill('wrong-password');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.locator('#join-error')).toContainText('Неверная');
  await page.getByLabel('Пароль',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect.poll(async () => (await net(page)).status).toBe('connected');
  await expect(page.locator('#join-dialog')).not.toBeVisible();
  await expect.poll(async () => (await state(page)).skin).toBe(12);
  await page.goto('/?room=does-not-exist',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#join-error')).toBeVisible();
  await expect(page.locator('#character-step')).not.toBeVisible();
  await page.getByRole('button',{name:'Войти в другой зал',exact:true}).click();
  await expect(page.locator('#join-dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await expect(page.getByLabel('Почта',{exact:true})).toBeVisible();
  await expect.poll(async()=> (await net(page)).status).toBe('disconnected');
});

test('unauthenticated and cross-origin requests cannot enter or edit an account', async ({request}) => {
  expect((await request.post('/api/auth/character',{data:{skin:2}})).status()).toBe(401);
  expect((await request.post('/api/auth/login',{headers:{Origin:'https://other.example'},data:{email:email(),password}})).status()).toBe(403);
  const client = new Client(process.env.TEST_BASE_URL || 'http://127.0.0.1:2567');
  await expect(client.joinOrCreate('lobby',{name:'Forged',skin:2})).rejects.toMatchObject({code:401});
});

test('character validation and repeated password attempts are limited', async ({request}) => {
  const address=email();
  expect((await request.post('/api/auth/login',{data:{email:address,password}})).ok()).toBe(true);
  expect((await request.post('/api/auth/character',{data:{skin:6}})).status()).toBe(400);
  expect((await request.post('/api/auth/character',{data:{skin:99}})).status()).toBe(400);
  expect((await request.post('/api/auth/character',{data:{skin:'2'}})).status()).toBe(400);
  for(let i=0;i<9;i++) expect((await request.post('/api/auth/login',{data:{email:address,password:'incorrect-password'}})).status()).toBe(401);
  expect((await request.post('/api/auth/login',{data:{email:address,password:'incorrect-password'}})).status()).toBe(429);
  await request.post('/api/auth/logout');
});

test('standing bar drinks are shared and former furniture does not create seats online',async({browser})=>{
  test.setTimeout(65000);
  const ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();
  const alias=await join(a,'Лаунж A');const id=(await net(a)).selfId;
  await join(b,'Лаунж B','/?room='+(await net(a)).roomId);
  await expect(a.locator('#sit-bar,#sit-sofa')).toHaveCount(0);
  await a.getByRole('button',{name:'Мини-бар',exact:true}).click();
  await expect(a.locator('#bar-dialog')).toBeVisible({timeout:12000});
  expect((await state(a)).seat).toBe('');
  await a.getByRole('button',{name:'Напитки',exact:true}).click();
  await a.locator('[data-drink="coffee"]').click();
  await expect(b.locator('#people-list')).toContainText(alias+' · 01 · пьёт');
  await expect.poll(async()=>(await state(b)).remotePositions.find((p:any)=>p.id===id)?.action).toBe('drink');
  await expect.poll(async()=>(await state(b)).remotePositions.find((p:any)=>p.id===id)?.seat).toBe('');
  await expect.poll(async()=>(await state(a)).action,{timeout:6000}).toBe('idle');
  await a.getByRole('button',{name:'Напитки',exact:true}).click();
  await a.locator('[data-drink="coffee"]').click();
  await expect.poll(async()=>(await state(a)).action).toBe('drink');
  await a.locator('#bar-dialog [data-close]').click();
  await a.getByRole('button',{name:'Встать',exact:true}).click();
  await expect.poll(async()=>(await state(b)).remotePositions.find((p:any)=>p.id===id)?.seat).toBe('');
  await expect.poll(async()=>(await state(b)).remotePositions.find((p:any)=>p.id===id)?.action).toBe('idle');
  await b.getByRole('button',{name:'Мини-бар',exact:true}).click();
  await expect(b.locator('#bar-dialog')).toBeVisible({timeout:12000});
  expect((await state(b)).seat).toBe('');
  const point=await worldPoint(a,320,400);await a.mouse.click(point.x,point.y);
  await expect.poll(async()=>Math.hypot((await state(a)).x-320,(await state(a)).y-400),{timeout:12000}).toBeLessThan(4);
  expect((await state(a)).seat).toBe('');
  await expect(b.locator('#people-list')).not.toContainText(alias+' · 01 · сидит');
  await ca.close();await cb.close();
});

test('chat continues past history capacity and keeps scrolling usable across tabs and mobile', async ({ browser, request }) => {
  test.setTimeout(150000);
  // A dedicated room prevents the long transcript from reaching existing players.
  const login = await request.post('/api/auth/login', {data:{email:email(),password}});
  expect(login.ok()).toBe(true);
  const cookie = login.headers()['set-cookie'].split(';')[0];
  expect((await request.post('/api/auth/character', {data:{skin:0}})).ok()).toBe(true);
  const host = new Client(process.env.TEST_BASE_URL || 'http://127.0.0.1:2567', {headers:{Cookie:cookie}});
  const room = await host.create('lobby');
  room.onMessage('chat', () => {});
  const ca = await browser.newContext(), cb = await browser.newContext();
  try {
    const a = await ca.newPage(), b = await cb.newPage();
    await join(a, 'Читатель', `/?room=${room.roomId}`);
    await join(b, 'Автор', `/?room=${(await net(a)).roomId}`);
    const prefix = `Лента-${crypto.randomUUID().slice(0, 8)}`;
    const send = async (page: Page, text: string) => {
      await showChat(page);await page.locator('#chat-input').fill(text);
      await page.locator('#send-chat').click();
      await expect(page.locator('#chat-log')).toContainText(text,{timeout:15000});
    };
    const gap = () => a.locator('#chat-log').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
    // Exercise real WebSocket traffic and history eviction within the ten-second spam window.
    for (let batch = 0; batch < 9; batch++) {
      if (batch) await a.waitForTimeout(10100);
      for (let i = 0; i < 4; i++) {
        await send(a, `${prefix} A ${batch}:${i} Проверка длинной переписки в зале`);
        await send(b, `${prefix} B ${batch}:${i} Новые сообщения продолжают приходить`);
      }
    }
    await expect(a.locator('#chat-log > div')).toHaveCount(60);
    await expect(a.locator('#chat-log')).not.toContainText(`${prefix} A 0:0`);
    await expect(a.locator('#chat-log')).toContainText(`${prefix} B 8:3`);
    await expect.poll(gap).toBeLessThan(3);
    const panelHeight = await a.locator('#chat-panel').evaluate(el => el.clientHeight);
    await a.locator('#games-tab').click();
    await a.waitForTimeout(5100);
    await send(b, `${prefix} Пришло пока открыты автоматы`);
    await a.locator('#panel-close').click();
    await expect.poll(gap).toBeLessThan(3);
    // Preserve the visible message when earlier rows are evicted.
    await a.locator('#chat-log').evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
    await a.waitForTimeout(100);
    const anchor = await a.locator('#chat-log').evaluate(el => {
      const top = el.getBoundingClientRect().top;
      const row = [...el.children].find(row => row.getBoundingClientRect().bottom > top)! as HTMLElement;
      return { id: row.dataset.messageId!, offset: row.getBoundingClientRect().top - top };
    });
    await send(b, `${prefix} Новое во время чтения истории`);
    await expect(a.locator('#new-messages')).toBeVisible();
    const offset = await a.locator('#chat-log').evaluate((el, id) => {
      const row = [...el.children].find(row => (row as HTMLElement).dataset.messageId === id)!;
      return row.getBoundingClientRect().top - el.getBoundingClientRect().top;
    }, anchor.id);
    expect(Math.abs(offset - anchor.offset)).toBeLessThan(2);
    await a.locator('#new-messages').click();
    await expect.poll(gap).toBeLessThan(3);
    await expect(a.locator('#new-messages')).toBeHidden();
    expect(await a.locator('#chat-panel').evaluate(el => el.clientHeight)).toBe(panelHeight);
    await a.setViewportSize({width:390, height:844});
    await a.locator('#chat-input').scrollIntoViewIfNeeded();
    await send(a, `${prefix} Продолжаю с телефона`);
    await expect.poll(gap).toBeLessThan(3);
    expect(await a.locator('#chat-log').evaluate(el => el.clientHeight)).toBeGreaterThan(80);
    await expect(a.locator('#send-chat')).toBeInViewport();
    await a.screenshot({path:'artifacts/chat-long-mobile.png',fullPage:true});
    await a.setViewportSize({width:1440,height:1000});
    await a.screenshot({path:'artifacts/chat-long-desktop.png',fullPage:true});
  } finally { await ca.close(); await cb.close(); await room.leave(); await request.post('/api/auth/logout'); }
});

test('Shift accelerates and pointer and button routes sprint by default online', async ({page}) => {
  const {verifySprint} = await import('./sprint');
  await join(page, 'Бегун');
  await verifySprint(page);
});

test('sprint stops without rollback when delayed movement packets arrive together', async ({page}) => {
  await holdMovementPackets(page);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await join(page,'Без отката');
  await expect.poll(async ()=>(await state(page)).serverX).toBeDefined();
  for(const direction of ['d','a','d']) {
    await page.evaluate(()=>{(window as any).__holdMovement=true;});
    await page.keyboard.down('Shift');await page.keyboard.down(direction);
    await page.waitForTimeout(320);
    await page.keyboard.up(direction);await page.keyboard.up('Shift');
    await expect.poll(async ()=>(await state(page)).moving).toBe(false);
    const stopped=await state(page);
    expect(stopped.pendingInputs).toBeGreaterThan(0);
    const drift=await page.evaluate(()=>new Promise<number>(resolve=>{
      const before=(window as any).royalDemo.getState(),start=performance.now();
      let maxDrift=0;
      (window as any).__releaseMovement();
      function sample(){
        const s=(window as any).royalDemo.getState();
        maxDrift=Math.max(maxDrift,Math.hypot(s.renderX-before.renderX,s.renderY-before.renderY));
        if(performance.now()-start<900)requestAnimationFrame(sample);else resolve(maxDrift);
      }
      requestAnimationFrame(sample);
    }));
    expect(drift,'the visible character must stay at the stopping point').toBeLessThan(1);
    await expect.poll(async ()=>(await state(page)).pendingInputs).toBe(0);
    const settled=await state(page);
    expect(Math.hypot(settled.x-stopped.x,settled.y-stopped.y)).toBeLessThan(.5);
    expect(Math.hypot(settled.x-settled.serverX,settled.y-settled.serverY)).toBeLessThan(.5);
  }
  await page.getByRole('button',{name:'Мини-бар',exact:true}).click();
  await expect(page.locator('#bar-dialog')).toBeVisible({timeout:12000});
  expect((await state(page)).seat).toBe('');
  await page.locator('#bar-dialog [data-close]').click();
  await expect.poll(async ()=>(await state(page)).locked).toBe(false);
  await page.locator('#game').focus();
  const barX=(await state(page)).x;
  await page.keyboard.down('Shift');await page.keyboard.down('a');
  await expect.poll(async ()=>(await state(page)).seat).toBe('');
  await expect.poll(async ()=>(await state(page)).serverX).toBeLessThan(barX-15);
  await page.keyboard.up('a');await page.keyboard.up('Shift');
  await expect.poll(async ()=>(await state(page)).pendingInputs).toBe(0);
  expect(errors).toEqual([]);
});

async function holdMovementPackets(page: Page) {
  await page.addInitScript(() => {
    const NativeWebSocket=window.WebSocket;
    const queued: (()=>void)[]=[];
    (window as any).__holdMovement=false;
    (window as any).__releaseMovement=()=>{
      (window as any).__holdMovement=false;
      for(const send of queued.splice(0))send();
    };
    window.WebSocket=class extends NativeWebSocket {
      send(data:string|ArrayBufferLike|Blob|ArrayBufferView) {
        const copy=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice():data instanceof ArrayBuffer?data.slice(0):data;
        const send=()=>{if(this.readyState===NativeWebSocket.OPEN)super.send(copy);};
        if((window as any).__holdMovement)queued.push(send);else send();
      }
    };
  });
}

async function delayedSprint(page: Page, duration=320) {
  await holdMovementPackets(page);
  await join(page,'Проверка очереди');
  const start=await worldPoint(page,600,570);
  await page.mouse.click(start.x,start.y);
  await expect.poll(async()=>Math.hypot((await state(page)).x-600,(await state(page)).y-570)).toBeLessThan(5);
  await expect.poll(async()=>(await state(page)).moving).toBe(false);
  await page.evaluate(()=>{(window as any).__holdMovement=true;});
  await page.keyboard.down('Shift');await page.keyboard.down('a');
  await page.waitForTimeout(duration);
  await page.keyboard.up('a');await page.keyboard.up('Shift');
  await expect.poll(async()=>(await state(page)).moving).toBe(false);
  const stopped=await state(page);
  expect(stopped.pendingInputs).toBeGreaterThan(0);
  await page.evaluate(()=>{
    const initial=(window as any).royalDemo.getState();
    const trace={active:true,drift:0,backwards:0};(window as any).__movementTrace=trace;
    function sample(){
      const s=(window as any).royalDemo.getState();
      trace.drift=Math.max(trace.drift,Math.hypot(s.renderX-initial.renderX,s.renderY-initial.renderY));
      trace.backwards=Math.max(trace.backwards,s.renderX-initial.renderX);
      if(trace.active)requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  return stopped;
}
async function releaseMovement(page: Page) {
  await page.evaluate(()=>{(window as any).__releaseMovement();});
  await expect.poll(async()=>(await state(page)).pendingInputs,{timeout:8000}).toBe(0);
  await expect.poll(async()=>{const s=await state(page);return Math.hypot(s.x-s.serverX,s.y-s.serverY);}).toBeLessThan(.5);
}
async function movementTrace(page: Page) {
  return page.evaluate(()=>{const trace=(window as any).__movementTrace;trace.active=false;return trace as {drift:number;backwards:number};});
}

test('opening chat during delayed sprint preserves the stopping point',async({page})=>{
  const stopped=await delayedSprint(page);
  await page.locator('#chat-input').focus();
  await page.waitForTimeout(160);
  expect(Math.abs((await state(page)).renderX-stopped.renderX)).toBeLessThan(1);
  await releaseMovement(page);
  await expect.poll(async()=>(await state(page)).predicted).toBe(false);
  expect((await movementTrace(page)).drift).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await page.keyboard.down('d');await page.waitForTimeout(150);await page.keyboard.up('d');
  await expect.poll(async()=>(await state(page)).x).toBeGreaterThan(stopped.x+10);
});

test('a pointer route waits for delayed sprint steps without snapping backwards',async({page})=>{
  const stopped=await delayedSprint(page);
  const target={x:stopped.x-100,y:570},point=await worldPoint(page,target.x,target.y);
  await page.mouse.click(point.x,point.y);
  await page.waitForTimeout(160);
  expect(Math.abs((await state(page)).renderX-stopped.renderX)).toBeLessThan(1);
  await releaseMovement(page);
  await expect.poll(async()=>Math.hypot((await state(page)).x-target.x,(await state(page)).y-target.y)).toBeLessThan(5);
  expect((await movementTrace(page)).backwards).toBeLessThan(1);
});

test('a long network stall drains all movement and the next key does not reveal a lost tail',async({page})=>{
  const stopped=await delayedSprint(page,1250);
  await releaseMovement(page);
  expect((await movementTrace(page)).drift).toBeLessThan(1);
  expect(Math.abs((await state(page)).x-stopped.x)).toBeLessThan(.5);
  await page.keyboard.down('d');await page.waitForTimeout(180);await page.keyboard.up('d');
  await expect.poll(async()=>(await state(page)).pendingInputs).toBe(0);
  const next=await state(page);
  expect(next.x-stopped.x).toBeGreaterThan(15);expect(next.x-stopped.x).toBeLessThan(45);
  expect(Math.abs(next.x-next.serverX)).toBeLessThan(.5);
});
