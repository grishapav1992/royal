import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { validStudioSettlement, validStudioSlotPresentation, type StudioSlotView, type StudioSlotPresentation, type StudioClusterPresentationGameId } from '../src/shared/studioGames';
import type { ExpansionSession } from '../src/shared/casinoExpansion';

const directory = 'artifacts/studio-wave4-20261012';
const endpoint = '/api/demo-wallet/expansion';
const password = 'Royal-wave4-isolated-browser-password!';
type Reply = { session: ExpansionSession; wallet: { balance: number; entries: { operationId: string; kind: string }[] }; replayed: boolean };
type MetadataRead = { status: number; url: string; accountId: string; query: Record<string, string>; payload: StudioSlotPresentation; walletBefore: unknown; walletAfter: unknown };
let host: Room, room = '';
function record(account: { id: string; email: string }) { if (process.env.ROYAL_WAVE4_RECORDS) appendFileSync(process.env.ROYAL_WAVE4_RECORDS, JSON.stringify(account) + '\n'); }
function proof(value: unknown) { mkdirSync(directory, { recursive: true }); appendFileSync(directory + '/public-rounds.jsonl', JSON.stringify(value) + '\n'); }

test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/auth/login', { data: { email: `royalwave4-host-${crypto.randomUUID()}@example.test`, password } });
  expect(auth.ok()).toBe(true); record((await auth.json()).account); await request.post('/api/auth/character', { data: { skin: 0 } });
  host = await new Client(process.env.TEST_BASE_URL!, {
    headers: { Cookie: auth.headers()['set-cookie'].split(';')[0] },
    fetchFn: async (url, options) => { const response = await request.fetch(String(url), { method: options?.method, headers: Object.fromEntries(new Headers(options?.headers)), data: options?.body as string }); return new globalThis.Response(await response.body(), { status: response.status(), headers: response.headers() }); },
  }).create('lobby'); room = host.roomId;
  for (const type of ['chat', 'activities', 'piano-note', 'notice']) host.onMessage(type, () => {});
});
test.afterAll(async () => { await host?.leave(); });

async function joined(page: Page) { await page.bringToFront(); await expect(page.locator('#join-dialog')).toBeHidden({ timeout: 20000 }); if (await page.locator('#room-overview').getAttribute('aria-pressed') !== 'true') await page.locator('#room-overview').click(); }
async function login(page: Page) {
  await page.addInitScript(()=>{const events:unknown[]=[];(window as any).__royalWave4Events=events;let previous='';const sample=()=>{const root=document.querySelector<HTMLElement>('[data-cluster-slot]');if(root){const event={phase:root.dataset.phase,sessionId:root.dataset.sessionId,step:Number(root.dataset.step),token:root.dataset.animationToken??'',activeGroup:root.dataset.activeGroup??'',activeCollector:root.dataset.activeCollector??'',reels:[...root.querySelectorAll<HTMLElement>('[data-cluster-reel]')].map(reel=>reel.dataset.state),grid:[...root.querySelectorAll<HTMLElement>('[data-cluster-cell]')].map(cell=>({position:Number(cell.dataset.clusterCell),symbol:Number(cell.dataset.symbol)})).sort((a,b)=>a.position-b.position),clones:[...root.querySelectorAll<HTMLElement>('[data-cluster-collected-seed]')].map(clone=>({position:Number(clone.dataset.clusterCollectedSeed),collector:Number(clone.dataset.collector)})),values:[...root.querySelectorAll<HTMLElement>('[data-cluster-value]')].map(value=>({position:Number(value.dataset.clusterValue),value:Number(value.dataset.value)})).sort((a,b)=>a.position-b.position)};const key=JSON.stringify(event);if(key!==previous){events.push(event);previous=key;}}requestAnimationFrame(sample);};requestAnimationFrame(sample);});
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/?room=' + room);
  await page.getByLabel('Почта', { exact: true }).fill(`royalwave4-${crypto.randomUUID()}@example.test`); await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.locator('#character-step')).toBeVisible(); await page.getByRole('button', { name: 'Войти в зал', exact: true }).click(); await joined(page);
  const account = (await (await page.request.get('/api/auth/me')).json()).account; record(account);
  await page.getByRole('button', { name: 'Открыть демокошелёк' }).click(); await page.getByRole('button', { name: 'Пополнить демобаланс', exact: true }).click();
  await expect(page.locator('#wallet-balance')).toHaveText(/1\s000/); await page.getByRole('button', { name: 'Закрыть кошелёк' }).click();
  return { account, headers: { 'X-Royal-Account-Id': account.id as string } };
}
async function open(page: Page, game: StudioClusterPresentationGameId) {
  if (!await page.locator('[data-studio-filter="all"]').isVisible()) await page.locator('#games-tab').click();
  await page.locator('[data-studio-filter="all"]').click(); await page.locator(`[data-studio="${game}"]`).click();
  await expect(page.locator(`[data-studio-slot="${game}"]`)).toBeVisible({ timeout: 60000 }); await expect(page.locator('[data-cluster-refresh]')).toBeEnabled();
}
async function close(page: Page) { await page.locator('#mini-dialog .mini-top [data-close]').click(); }
async function wallet(request: APIRequestContext, headers: Record<string, string>) { const response = await request.get('/api/demo-wallet', { headers }); expect(response.ok()).toBe(true); return response.json(); }

async function coreVisible(page: Page) {
  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('#mini-dialog')!, rect = dialog.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, dialog: { top: rect.top, bottom: rect.bottom, scrollTop: dialog.scrollTop }, core: ['[data-cluster-reels]', '[data-cluster-stake]', '[data-cluster-spin]'].map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { selector, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }) };
  });
  expect(geometry.dialog.scrollTop).toBe(0);
  for (const rect of geometry.core) { expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(geometry.width); expect(rect.top).toBeGreaterThanOrEqual(Math.max(0, geometry.dialog.top)); expect(rect.bottom).toBeLessThanOrEqual(Math.min(geometry.height, geometry.dialog.bottom)); }
  return geometry;
}

async function checkStage(page: Page, value: Reply, game: StudioClusterPresentationGameId) {
  const s = value.session, view = s.view.studio as StudioSlotView;
  expect(s.gameId).toBe(game); expect(validStudioSettlement(game, s.state, s.stakeUnits, s.spentUnits, s.returnedUnits, view)).toBe(true);
  await expect(page.locator('[data-cluster-spin]')).toBeEnabled({ timeout: 20000 }); await expect(page.locator('.studio-error')).toBeEmpty();
  await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-session-id', s.id); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-step', String(view.step));
  await expect(page.locator('[data-cluster-payout]')).toHaveAttribute('data-units', view.totalPayoutUnits); await expect(page.locator('[data-cluster-payout]')).toHaveAttribute('data-target-units', view.totalPayoutUnits);
  await expect(page.locator('.studio-stage-payout strong')).toHaveText((Number(view.totalPayoutUnits) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' монет');
  await expect(page.locator('[data-studio-balance]')).toHaveText(value.wallet.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const cells = await page.locator('[data-cluster-cell]').evaluateAll(elements => elements.map(element => ({ position: Number((element as HTMLElement).dataset.clusterCell), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a, b) => a.position - b.position));
  expect(cells.map(cell => cell.symbol)).toEqual(view.grid); expect(cells.length).toBe(game==='studio-lumen-grove'?30:36);
  await checkCellValues(page,game,view.step);
  expect(value.wallet.entries.filter(entry => entry.operationId === s.id && entry.kind === 'bet')).toHaveLength(1);
  if (s.state === 'active') { expect(s.returnedUnits).toBe('0'); await expect(page.locator('[data-move="studio-spin"]')).toBeEnabled(); }
  else { expect(s.returnedUnits).toBe(view.totalPayoutUnits); expect(value.wallet.entries.filter(entry => entry.kind === 'win')).toHaveLength(1); }
  await expect(page.locator('[data-cluster-group-button]')).toHaveCount(view.wins.length);
  await expect(page.locator('[data-slot-lines]')).toHaveCount(0);
  return view;
}
async function checkCellValues(page:Page,game:StudioClusterPresentationGameId,step:number){
  const shown=await page.locator('[data-cluster-value]').evaluateAll(elements=>elements.map(element=>({position:Number((element as HTMLElement).dataset.clusterValue),value:Number((element as HTMLElement).dataset.value)})).sort((a,b)=>a.position-b.position));
  expect(shown).toEqual(game==='studio-prism-atelier'?Array.from({length:36},(_,position)=>({position,value:1+(position+step)%3})):[]);
}

function checkMetadata(metadata: StudioSlotPresentation, session: ExpansionSession, game: StudioClusterPresentationGameId) {
  const view = session.view.studio as StudioSlotView, frame = view.history[view.step];
  expect(validStudioSlotPresentation(metadata, game, session.id, session.view.phase, view)).toBe(true);
  const trace = metadata.cluster!; expect(trace).toBeDefined(); expect(metadata.afterGrid).toEqual(frame.grid); expect(metadata.beforeGrid).toEqual(frame.grid); expect(metadata.cascade).toBeUndefined();
  expect([metadata.heldBefore,metadata.heldAfter,metadata.events,metadata.multipliers]).toEqual([[],[],[],[]]);
  const groups = frame.wins.flatMap((win,winIndex)=>win.kind==='cluster'?[{winIndex,symbol:win.symbol,count:win.count,positions:win.positions}]:[]); expect(trace.groups).toEqual(groups);
  for(const group of trace.groups){
    expect(group.count).toBeGreaterThanOrEqual(5);expect(group.count).toBe(group.positions.length);expect(group.positions.every(position=>frame.grid[position]===group.symbol)).toBe(true);
    const reached=new Set([group.positions[0]]),pending=[group.positions[0]],members=new Set(group.positions);
    while(pending.length){const at=pending.pop()!,neighbors=[at-6,at+6];if(at%6)neighbors.push(at-1);if(at%6<5)neighbors.push(at+1);for(const next of neighbors)if(members.has(next)&&!reached.has(next)){reached.add(next);pending.push(next);}}
    expect(reached.size).toBe(group.count);
  }
  if(game==='studio-lumen-grove'){
    const coins=frame.grid.flatMap((symbol,position)=>symbol===5?[{position,rawValue:2+position%4}]:[]),collectors=frame.grid.flatMap((symbol,position)=>symbol===4?[position]:[]).slice(0,2);
    expect(trace.collects).toEqual(coins.length?collectors.map(collector=>({winIndex:frame.wins.findIndex(win=>win.kind==='collect'&&win.positions[0]===collector),collector,coins})):[]);
    expect(trace.cellValues).toEqual([]);expect(trace.groupFactors).toEqual([]);
    for(const collect of trace.collects){const win=frame.wins[collect.winIndex];expect(win.positions).toEqual([collect.collector,...collect.coins.map(coin=>coin.position)]);expect(win.raw).toBe(collect.coins.reduce((sum,coin)=>sum+coin.rawValue,0));}
  }else{
    expect(trace.collects).toEqual([]);expect(trace.cellValues).toEqual(frame.grid.map((_,position)=>({position,value:1+(position+view.step)%3})));
    expect(trace.groupFactors).toEqual(trace.groups.map(group=>({winIndex:group.winIndex,factor:group.positions.reduce((sum,position)=>sum+1+(position+view.step)%3,0)})));
    for(const group of trace.groups){const factor=trace.groupFactors.find(item=>item.winIndex===group.winIndex)!.factor;expect(frame.wins[group.winIndex].raw).toBe((group.count-4)*(group.symbol+2)*2*factor);}
  }
  expect(Object.keys(metadata)).not.toContain('seeds'); expect(Object.keys(metadata)).not.toContain('stops');
}

async function routeMetadata(page: Page, accountId: string) {
  const metadata: StudioSlotPresentation[] = [];
  const reads: MetadataRead[]=[];
  await page.route('**/api/demo-wallet/expansion/presentation?*', async route => {
    const claim=route.request().headers()['x-royal-account-id'];expect(claim).toBe(accountId);const headers={'X-Royal-Account-Id':accountId},before=await wallet(page.request,headers);
    const response=await route.fetch();expect(response.status()).toBe(200);const payload=await response.json() as StudioSlotPresentation;metadata.push(payload);
    const after=await wallet(page.request,headers);expect(after.balance).toBe(before.balance);expect(after.entries).toEqual(before.entries);
    reads.push({status:response.status(),url:route.request().url(),accountId:claim,query:Object.fromEntries(new URL(route.request().url()).searchParams),payload,walletBefore:before,walletAfter:after});await route.fulfill({response});
  });
  return {metadata,reads};
}
async function confirmLive(page: Page, value: Reply, game: StudioClusterPresentationGameId, metadata: StudioSlotPresentation[]) {
  await checkStage(page, value, game); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'available');
  const view = value.session.view.studio as StudioSlotView, payload = metadata.findLast(item => item.sessionId === value.session.id && item.step === view.step);
  expect(payload).toBeDefined(); checkMetadata(payload!, value.session, game);
  expect(JSON.parse(await page.locator('[data-studio-slot]').getAttribute('data-cluster-trace')??'null')).toEqual(payload!.cluster);
  const shownValues=await page.locator('[data-cluster-value]').evaluateAll(elements=>elements.map(element=>({position:Number((element as HTMLElement).dataset.clusterValue),value:Number((element as HTMLElement).dataset.value)})).sort((a,b)=>a.position-b.position));expect(shownValues).toEqual(payload!.cluster!.cellValues);
  await expect(page.locator('[data-cluster-collect-layer]')).toHaveCount(0);
}
async function advance(page: Page, value: Reply, game: StudioClusterPresentationGameId, metadata: StudioSlotPresentation[]) {
  const response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-move="studio-spin"]').click();await expect(page.locator('[data-cluster-spin]')).toBeDisabled();const first=await page.locator('[data-cluster-track]').evaluateAll(elements=>elements.map(element=>(element as HTMLElement).style.transform));await page.waitForTimeout(160);expect(await page.locator('[data-cluster-track]').evaluateAll(elements=>elements.map(element=>(element as HTMLElement).style.transform))).not.toEqual(first);
  const replyResponse = await response, next = await replyResponse.json() as Reply;
  expect(next.session.id).toBe(value.session.id); expect(next.session.spentUnits).toBe(value.session.spentUnits); expect((next.session.view.studio as StudioSlotView).step).toBe((value.session.view.studio as StudioSlotView).step + 1);
  await confirmLive(page, next, game, metadata); return { value: next, operationId: replyResponse.request().postDataJSON().id as string };
}
async function storedProof(page: Page, headers: Record<string, string>, value: Reply, creditedOperation: string) {
  const stored = await wallet(page.request, headers); expect(stored.balance).toBe(value.wallet.balance);
  expect(stored.balance).toBe((100000 - Number(value.session.spentUnits) + Number(value.session.returnedUnits)) / 100);
  expect(stored.entries.filter((entry: { kind: string }) => entry.kind === 'bet')).toHaveLength(1);
  expect(stored.entries.filter((entry: { kind: string }) => entry.kind === 'win')).toHaveLength(1);
  expect(stored.entries.find((entry: { kind: string }) => entry.kind === 'win').operationId).toBe(creditedOperation); return stored;
}
async function domEvents(page:Page){return page.evaluate(()=>(window as any).__royalWave4Events as {phase:string;sessionId:string;step:number;token:string;activeGroup:string;activeCollector:string;reels:string[];grid:{position:number;symbol:number}[];clones:{position:number;collector:number}[];values:{position:number;value:number}[]}[]);}
async function checkLiveEffects(page:Page,session:ExpansionSession,presentation:StudioSlotPresentation){
  const events=(await domEvents(page)).filter(event=>event.sessionId===session.id&&event.step===(session.view.studio as StudioSlotView).step&&event.token);
  for(const group of presentation.cluster!.groups)expect(events.some(event=>event.activeGroup===String(group.winIndex))).toBe(true);
  for(const collect of presentation.cluster!.collects){const expected=collect.coins.map(coin=>({position:coin.position,collector:collect.collector}));expect(events.some(event=>event.phase==='collecting'&&event.activeCollector===String(collect.collector)&&JSON.stringify(event.clones)===JSON.stringify(expected)&&JSON.stringify(event.grid.map(cell=>cell.symbol))===JSON.stringify(presentation.afterGrid))).toBe(true);}
  if(presentation.cluster!.cellValues.length)expect(events.some(event=>JSON.stringify(event.values)===JSON.stringify(presentation.cluster!.cellValues))).toBe(true);
}

test('published Lumen completes one paid round with exact groups and collections, then restores silently', async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 1440, height: 900 }); const game = 'studio-lumen-grove';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const { account, headers } = await login(page), {metadata,reads} = await routeMetadata(page,account.id);
  const operations: { id: string; action: string; sessionId?: string }[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => { if (route.request().method() !== 'POST') return route.continue(); operations.push(route.request().postDataJSON()); const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 350)); await route.fulfill({ response }); });
  await open(page, game); const initialGeometry = await coreVisible(page), response = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-cluster-spin]').click(); await expect(page.locator('[data-cluster-spin]')).toBeDisabled(); await expect(page.locator('[data-cluster-stake]')).toBeDisabled();
  const firstMotion = await page.locator('[data-cluster-track]').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.transform)); await page.waitForTimeout(160);
  expect(await page.locator('[data-cluster-track]').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.transform))).not.toEqual(firstMotion);
  await page.locator('[data-cluster-spin]').evaluate((button: HTMLButtonElement) => button.click());
  let value = await (await response).json() as Reply, creditedOperation = value.session.id; const stages: ExpansionSession[] = [value.session],stageReplies:Reply[]=[value];
  await confirmLive(page, value, game, metadata);await checkLiveEffects(page,value.session,metadata.at(-1)!);
  while (value.session.state === 'active') { const next = await advance(page, value, game, metadata); value = next.value; creditedOperation = next.operationId; stages.push(value.session);stageReplies.push(value);expect(stages.length).toBeLessThanOrEqual(3);await checkLiveEffects(page,value.session,metadata.at(-1)!); }
  expect(stages.length).toBe((stages[0].view.studio as StudioSlotView).remaining?3:1);
  expect(operations.filter(operation => operation.action === 'start')).toHaveLength(1); expect(new Set(operations.map(operation => operation.id)).size).toBe(operations.length);
  const stored = await storedProof(page, headers, value, creditedOperation), finalGeometry = await coreVisible(page), played = await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game);
  expect(played.click).toBe(1); expect(played['reel-stop']).toBe(6*stages.length);expect(played['free-stage']??0).toBe(stages.length-1);expect(played.collect??0).toBe(metadata.reduce((sum,item)=>sum+item.cluster!.collects.length,0));expect(played.group??0).toBe(metadata.reduce((sum,item)=>sum+item.cluster!.groups.length,0));
  const beforeMetadataCount = metadata.length; await page.locator('[data-cluster-refresh]').click(); await expect(page.locator('[data-cluster-refresh]')).toBeEnabled(); await close(page); await open(page, game);
  await checkStage(page, value, game); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'static');
  for (let index = 0; index < ((value.session.view.studio as StudioSlotView).history.length>1?stages.length:0); index++) {
    await page.locator(`[data-cluster-frame="${index}"]`).evaluate((button: HTMLButtonElement) => button.click()); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-frame-index', String(index));
    const shown = await page.locator('[data-cluster-cell]').evaluateAll(elements => elements.map(element => ({ index: Number((element as HTMLElement).dataset.clusterCell), symbol: Number((element as HTMLElement).dataset.symbol) })).sort((a, b) => a.index - b.index));
    expect(shown.map(cell => cell.symbol)).toEqual((value.session.view.studio as StudioSlotView).history[index].grid);
  }
  expect(await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game)).toEqual(played); expect(metadata).toHaveLength(beforeMetadataCount);
  await close(page); await open(page, game); await checkStage(page, value, game); await page.setViewportSize({ width: 1280, height: 720 }); const laptopGeometry = await coreVisible(page);
  proof({ scenario: 'lumen-desktop', accountId: account.id, sessionId: value.session.id, operations, metadata,metadataReads:reads, stages,stageReplies, stored, initialGeometry, finalGeometry, laptopGeometry, played,domEvents:await domEvents(page) });
  await page.screenshot({ path: directory + '/public-lumen-desktop.png' }); await close(page); expect(errors).toEqual([]);
});

test('published Prism restores a lost committed free spin and completes two free stages without another stake', async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 390, height: 844 }); const game = 'studio-prism-atelier';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const { account, headers } = await login(page), {metadata,reads} = await routeMetadata(page,account.id);
  let committed: Reply | undefined, lostId = ''; const operations: { id: string; action: string; sessionId?: string }[] = [];
  await page.route('**/api/demo-wallet/expansion', async route => {
    if (route.request().method() !== 'POST') return route.continue(); const operation = route.request().postDataJSON(); operations.push(operation);
    if (operation.action !== 'move' || committed) return route.continue(); const response = await route.fetch(); expect(response.ok()).toBe(true); lostId = operation.id; committed = await response.json(); await route.abort('failed');
  });
  await open(page, game); const initialGeometry = await coreVisible(page), startResponse = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-cluster-spin]').click(); const base = await (await startResponse).json() as Reply; await confirmLive(page, base, game, metadata);await checkLiveEffects(page,base.session,metadata.at(-1)!);expect(base.session.state).toBe('active');
  await page.locator('[data-move="studio-spin"]').click(); await expect(page.locator('[data-cluster-retry]')).toBeEnabled({ timeout: 20000 }); expect(committed).toBeDefined(); expect((committed!.session.view.studio as StudioSlotView).step).toBe(1);
  const beforeReloadEvents=await domEvents(page);await close(page); await page.reload(); await joined(page); await open(page, game); await expect(page.locator('[data-cluster-retry]')).toBeEnabled();
  const beforeReplayAudio = await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game), retryResponse = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
  await page.locator('[data-cluster-retry]').click(); const replay = await (await retryResponse).json() as Reply; expect(replay.replayed).toBe(true); expect(replay.session).toEqual(committed!.session);
  expect(operations.filter(operation => operation.id === lostId)).toHaveLength(2);expect(replay.session.state).toBe('active');await checkStage(page, replay, game); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'static');
  expect(await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game)).toEqual(beforeReplayAudio);
  const beforeRead = await wallet(page.request, headers), readResponse = await page.request.get(endpoint + '/presentation', { headers, params: { sessionId: replay.session.id, phase: String(replay.session.view.phase), step: '1' } });
  expect(readResponse.status()).toBe(200); const restoredMetadata = await readResponse.json() as StudioSlotPresentation; checkMetadata(restoredMetadata, replay.session, game);
  const afterRead = await wallet(page.request, headers); expect(afterRead.balance).toBe(beforeRead.balance); expect(afterRead.entries).toEqual(beforeRead.entries);
  let value = replay, creditedOperation = lostId; const stages: ExpansionSession[] = [base.session, replay.session],stageReplies:Reply[]=[base,replay];
  while (value.session.state === 'active') { const next = await advance(page, value, game, metadata); value = next.value; creditedOperation = next.operationId; stages.push(value.session);stageReplies.push(value);expect(stages.length).toBeLessThanOrEqual(3);await checkLiveEffects(page,value.session,metadata.at(-1)!); }expect(stages).toHaveLength(3);
  expect(operations.filter(operation => operation.action === 'start')).toHaveLength(1); expect(new Set(operations.map(operation => operation.id)).size).toBe(operations.length - 1);
  const stored = await storedProof(page, headers, value, creditedOperation), finalGeometry = await coreVisible(page);
  if (Number(value.session.returnedUnits) < Number(value.session.stakeUnits)) await expect(page.locator('[data-cluster-bigwin]')).toBeHidden();
  const played = await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game); await close(page); await open(page, game); await checkStage(page, value, game);
  expect(await page.evaluate(game => (window as any).royalDemo.getAudio().slot.byGame[game].played, game)).toEqual(played); await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-presentation', 'static');
  for(let index=0;index<3;index++){await page.locator(`[data-cluster-frame="${index}"]`).evaluate((button:HTMLButtonElement)=>button.click());await expect(page.locator('[data-studio-slot]')).toHaveAttribute('data-frame-index',String(index));const shown=await page.locator('[data-cluster-cell]').evaluateAll(elements=>elements.map(element=>({position:Number((element as HTMLElement).dataset.clusterCell),symbol:Number((element as HTMLElement).dataset.symbol)})).sort((a,b)=>a.position-b.position));expect(shown.map(cell=>cell.symbol)).toEqual((value.session.view.studio as StudioSlotView).history[index].grid);await checkCellValues(page,game,index);}
  expect(await page.evaluate(game=>(window as any).royalDemo.getAudio().slot.byGame[game].played,game)).toEqual(played);await close(page);await open(page,game);await checkStage(page,value,game);
  proof({ scenario: 'prism-mobile-lost-free-spin', accountId: account.id, sessionId: value.session.id, lostId, committed,operations, metadata,metadataReads:reads,restoredMetadata, presentationReadOnly: { before: beforeRead, after: afterRead }, stages,stageReplies, stored, initialGeometry, finalGeometry, played,beforeReloadEvents,domEvents:await domEvents(page) });
  await page.screenshot({ path: directory + '/public-prism-mobile.png' }); await close(page); expect(errors).toEqual([]);
});

