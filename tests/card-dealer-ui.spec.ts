import { test, expect, type Page } from '@playwright/test';
import { CARD_GAME_IDS, DEALER_PROFILES } from '../src/shared/cardTables';
import { NEXT_VARIANT_DEFAULTS } from '../src/shared/casinoNextVariants';
import { BATCH_VARIANT_DEFAULTS } from '../src/shared/casinoBatchVariants';
import { startNextVariant } from '../server/games/casinoNextVariants';
import { startBatchVariant } from '../server/games/casinoBatchVariants';

const variants=Object.fromEntries(['variant-color','variant-duel','variant-war'].map(id=>[id,startNextVariant(id as any,NEXT_VARIANT_DEFAULTS[id as keyof typeof NEXT_VARIANT_DEFAULTS],'1000',()=>0)]));
Object.assign(variants,Object.fromEntries(['variant-triple-poker','variant-blackjack-target'].map(id=>[id,startBatchVariant(id as any,BATCH_VARIANT_DEFAULTS[id as keyof typeof BATCH_VARIANT_DEFAULTS],'1000',()=>0)])));
const probe=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#272934;color:#eee6d4}#dealer,#host{box-sizing:border-box;width:min(100%,650px);margin:auto}#catalog{width:min(100%,360px);margin:auto}</style></head><body><div id="dealer"></div><div id="host"></div><div id="catalog"></div><script type="module">
import {CardDealerStage,emitCardDealer} from '/src/ui/CardDealerStage.ts';
import {CardTablesCatalog} from '/src/ui/CardTablesCatalog.ts';
import {CasinoExpansionUI} from '/src/ui/CasinoExpansionUI.ts';
import {CasinoNextVariantsUI} from '/src/ui/CasinoNextVariantsUI.ts';
import {CasinoBatchVariantsUI} from '/src/ui/CasinoBatchVariantsUI.ts';
import {CasinoSessionsUI} from '/src/ui/CasinoSessionsUI.ts';
import {GithubGames} from '/src/ui/GithubGames.ts';
import {isGithubGame} from '/src/shared/githubGames.ts';
import {isNextVariantGame} from '/src/shared/casinoNextVariants.ts';
import {isBatchVariantGame} from '/src/shared/casinoBatchVariants.ts';
import {expansionClient as client} from '/src/wallet/ExpansionClient.ts';
import {casinoClients} from '/src/wallet/CasinoClient.ts';
import {demoWallet} from '/src/wallet/WalletClient.ts';
import {CARD_GAME_IDS,DEALER_PROFILES} from '/src/shared/cardTables.ts';
const host=document.getElementById('host'),stageHost=document.getElementById('dealer');
const account='00000000-0000-4000-8000-000000000001';client.refresh=async()=>{};client.accountId=account;demoWallet.accountId=account;client.wallet={balance:1000,entries:[]};demoWallet.wallet=client.wallet;casinoClients.demo.refresh=async()=>{};casinoClients.usdt.refresh=async()=>{};casinoClients.demo.accountId=account;casinoClients.demo.wallet=client.wallet;
let ui,stage,catalog;
window.cardProbe={ids:CARD_GAME_IDS,profiles:DEALER_PROFILES,client,demoWallet,casinoClients,variants:${JSON.stringify(variants)},actions:[],snapshots:[],selected:[],operations:[],
mount(id){ui?.destroy();stage?.destroy();this.actions=[];this.snapshots=[];stage=new CardDealerStage(stageHost,id,host,action=>this.actions.push(action));host.addEventListener('royal-card-dealer',this.observe);ui=id==='github-hilo'?new CasinoSessionsUI(host,id):isGithubGame(id)?new GithubGames(host,id):isBatchVariantGame(id)?new CasinoBatchVariantsUI(host,id):isNextVariantGame(id)?new CasinoNextVariantsUI(host,id):new CasinoExpansionUI(host,id);},
observe(event){window.cardProbe.snapshots.push(event.detail);},
catalog(){catalog?.destroy();catalog=new CardTablesCatalog(document.getElementById('catalog'),id=>this.selected.push(id));},
session(id,options={}){const variant=this.variants[id],ended=options.ended??variant?.ended??false;return{id:options.id??'10000000-0000-4000-8000-000000000001',gameId:id,rulesVersion:1,state:ended?'settled':'active',stakeUnits:'1000',spentUnits:options.spent??'1000',returnedUnits:options.returned??(variant?String(variant.credit):'0'),view:{player:options.cards??['AS','KH','2C'],dealer:ended?['QS','QD','4C']:['QS'],community:[],actions:ended?[]:[{move:'fold',label:'Пас',cost:0}],phase:options.phase??1,ended,message:ended?'Партия завершена':'Твой ход',...(variant?{variant:variant.variant}:{})}};},
sessions(values){client.sessions=values;client.dispatchEvent(new Event('change'));},
snapshot(value){emitCardDealer(host,{gameId:'github-three-card',account,sessionId:'10000000-0000-4000-8000-000000000001',phase:1,cards:'[AS,KH,2C]',active:true,busy:false,pending:false,spentUnits:'1000',returnedUnits:'0',...value});},
lastSnapshot(){return this.snapshots.at(-1);},destroy(){ui?.destroy();stage?.destroy();catalog?.destroy();host.removeEventListener('royal-card-dealer',this.observe);}}
</script></body></html>`;
async function ready(page: Page, reduced=true) {
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
  await page.route('**/card-dealer-ui-probe',route=>route.fulfill({status:200,contentType:'text/html',body:probe}));
  await page.goto('/card-dealer-ui-probe');await page.waitForFunction(()=>!!(window as any).cardProbe);
}
const mount=(page:Page,id:string)=>page.evaluate(id=>(window as any).cardProbe.mount(id),id);
const deals=(page:Page)=>page.evaluate(()=>(window as any).cardProbe.actions.filter((a:string)=>a==='deal').length);
const actionCount=(page:Page)=>page.evaluate(()=>(window as any).cardProbe.actions.length);

test('all 33 tables show named overhead dealer hands on a phone in every UI family',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await ready(page);await page.setViewportSize({width:390,height:844});
  expect(CARD_GAME_IDS.length).toBe(33);expect(new Set(Object.values(DEALER_PROFILES).map(p=>p.name)).size).toBe(33);
  for(const id of CARD_GAME_IDS){await mount(page,id);await expect(page.locator('[data-card-dealer]')).toHaveAttribute('data-card-dealer',id);await expect(page.locator('[data-card-dealer]')).toHaveAttribute('data-dealer-view','overhead');await expect(page.locator('.card-dealer-caption strong')).toHaveText(DEALER_PROFILES[id].name);await expect(page.locator('.card-dealer-hands')).toHaveAttribute('aria-label',`Руки крупье ${DEALER_PROFILES[id].name}, вид сверху`);await expect(page.locator('.card-dealer-portrait')).toHaveCount(0);expect(await page.locator('.card-dealer-hands').evaluate((element:HTMLCanvasElement)=>element.width>0&&element.height>0)).toBe(true);expect(await page.locator('.card-dealer-stage').evaluate(e=>e.scrollWidth<=e.clientWidth+2),id).toBe(true);const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('*')].map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>391)}));expect(overflow.width, id+JSON.stringify(overflow)).toBeLessThanOrEqual(390);}
  expect(errors).toEqual([]);await page.screenshot({path:'artifacts/cardfloor-20261011/dealer-ui-mobile.png'});
});

test('catalogue opens the seven available chance game IDs and searches dealer names with keyboard access',async({page})=>{
  await ready(page);await page.evaluate(()=>(window as any).cardProbe.catalog());await expect(page.locator('[data-card-table]')).toHaveCount(7);
  const portraits=await page.locator('.card-table-portrait').evaluateAll(elements=>elements.map(e=>(e as HTMLCanvasElement).toDataURL()));expect(new Set(portraits).size).toBe(7);
  await page.getByLabel('Найти игру или крупье').fill('Алекс');await expect(page.locator('[data-card-table]:visible')).toHaveCount(1);await page.locator('[data-card-table="github-baccarat"]').focus();await page.keyboard.press('Enter');expect(await page.evaluate(()=>(window as any).cardProbe.selected)).toEqual(['github-baccarat']);
  await page.getByLabel('Найти игру или крупье').fill('неизвестный');await expect(page.locator('.card-tables-empty')).toBeVisible();await page.getByLabel('Найти игру или крупье').fill('');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=390)).toBe(true);await page.screenshot({path:'artifacts/cardfloor-20261011/card-catalog-mobile.png'});
});

test('reduced motion shows confirmed cards and results immediately without replay on balance refresh',async({page})=>{
  await ready(page);await mount(page,'github-three-card');await page.evaluate(()=>{const p=(window as any).cardProbe;p.sessions([p.session('github-three-card')]);});await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action','idle');await expect(page.locator('.card-dealer-status')).toHaveText('Твой ход, карты на столе');expect(await deals(page)).toBe(0);await expect(page.locator('.card-being-dealt')).toHaveCount(0);const activeActions=await actionCount(page);
  await page.evaluate(()=>{const p=(window as any).cardProbe;p.client.wallet.balance=9876;p.demoWallet.wallet.balance=9876;p.demoWallet.dispatchEvent(new Event('change'));p.client.dispatchEvent(new Event('change'));});expect(await actionCount(page)).toBe(activeActions);await expect(page.locator('.card-dealer-status')).toHaveText('Твой ход, карты на столе');
  await page.evaluate(()=>{const p=(window as any).cardProbe;p.sessions([p.session('github-three-card',{phase:2,ended:true,returned:'2000'})]);});await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action','win');await expect(page.locator('.card-dealer-status')).toHaveText('Поздравляю с выигрышем');expect(await page.evaluate(()=>(window as any).cardProbe.lastSnapshot().returnedUnits)).toBe('2000');expect(await deals(page)).toBe(0);const settledActions=await actionCount(page);
  await page.evaluate(()=>(window as any).cardProbe.client.dispatchEvent(new Event('change')));expect(await actionCount(page)).toBe(settledActions);
});

test('saved parties restore without dealing again and a fold without new cards uses the round result',async({page})=>{
  await ready(page);await page.evaluate(()=>{const p=(window as any).cardProbe;p.sessions([p.session('github-three-card')]);});await mount(page,'github-three-card');expect(await deals(page)).toBe(0);
  await page.evaluate(()=>{const p=(window as any).cardProbe;p.snapshot({...p.lastSnapshot(),active:false,returnedUnits:'0'});});await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action','lose');await expect(page.locator('.card-dealer-status')).toHaveText('Раздача завершена');expect(await deals(page)).toBe(0);
  await mount(page,'github-three-card');expect(await deals(page)).toBe(0);
});

test('a pending lost response waits for confirmation and replay keeps the same dealer transition',async({page})=>{
  await ready(page);await mount(page,'github-three-card');await page.evaluate(()=>{const p=(window as any).cardProbe;p.client.pending={id:'20000000-0000-4000-8000-000000000001',action:'start',gameId:'github-three-card',stakeUnits:'1000',settings:{side:false}};p.client.dispatchEvent(new Event('change'));});expect(await deals(page)).toBe(0);await expect(page.locator('.card-dealer-status')).toHaveText('Проверяем сохранённый ход');
  await page.evaluate(()=>{const p=(window as any).cardProbe;p.client.pending=undefined;p.sessions([p.session('github-three-card',{ended:true,returned:'0'})]);});await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action','lose');await expect(page.locator('.card-dealer-status')).toHaveText('Раздача завершена');expect(await deals(page)).toBe(0);expect(await page.evaluate(()=>(window as any).cardProbe.lastSnapshot().pending)).toBe(false);const confirmedActions=await actionCount(page);await page.evaluate(()=>(window as any).cardProbe.client.dispatchEvent(new Event('change')));expect(await actionCount(page)).toBe(confirmedActions);
});

test('Next and Batch card variants emit their own saved ID and exact round payments',async({page})=>{
  await ready(page);
  for(const id of ['variant-color','variant-duel','variant-war','variant-triple-poker','variant-blackjack-target']){await page.evaluate(id=>{const p=(window as any).cardProbe;p.sessions([p.session(id)]);},id);await mount(page,id);const snapshot=await page.evaluate(()=>(window as any).cardProbe.lastSnapshot());expect(snapshot.gameId).toBe(id);expect(snapshot.sessionId).toBe('10000000-0000-4000-8000-000000000001');expect(snapshot.spentUnits).toBe('1000');expect(snapshot.cards).not.toBe('');expect(await deals(page)).toBe(0);}
});

test('Hi-Lo uses its completed last party and cannot infer victory from the shared balance',async({page})=>{
  await ready(page);await mount(page,'github-hilo');await page.evaluate(()=>{const p=(window as any).cardProbe,c=p.casinoClients.demo;c.sessions=[{id:'10000000-0000-4000-8000-000000000002',gameId:'github-hilo',rulesVersion:1,state:'active',stakeUnits:'1000',payoutUnits:'0',multiplier:1,steps:0,cards:[{rank:7,suit:0}],next:{higher:1.98,lower:1.98}}];c.dispatchEvent(new Event('change'));});await expect(page.locator('.card-dealer-status')).toHaveText('Твой ход, карты на столе');expect(await deals(page)).toBe(0);
  await page.evaluate(()=>{const p=(window as any).cardProbe,c=p.casinoClients.demo;c.wallet.balance=9000;c.sessions=[];c.last={id:'10000000-0000-4000-8000-000000000002',gameId:'github-hilo',rulesVersion:1,state:'lost',stakeUnits:'1000',payoutUnits:'0',multiplier:0,steps:1,cards:[{rank:7,suit:0},{rank:2,suit:1}]};c.dispatchEvent(new Event('change'));});await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action','lose');
  await page.evaluate(()=>{const p=(window as any).cardProbe,c=p.casinoClients.demo;c.last={...c.last,state:'cashed_out',payoutUnits:'1980',multiplier:1.98};c.dispatchEvent(new Event('change'));});await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action','win');expect(await page.evaluate(()=>(window as any).cardProbe.lastSnapshot().returnedUnits)).toBe('1980');
});

test('practice card selection keeps the same hand and its dealer does not expose hidden opponent cards',async({page})=>{
  await ready(page);await mount(page,'github-video-poker');await page.locator('[data-action="start"]').click();await expect(page.locator('.card-dealer-status')).toHaveText('Твой ход, карты на столе');const hand=await page.evaluate(()=>(window as any).cardProbe.lastSnapshot().cards);const beforeHold=await actionCount(page);await page.locator('[data-hold="0"]').click();expect(await actionCount(page)).toBe(beforeHold);expect(await deals(page)).toBe(0);expect(await page.evaluate(()=>(window as any).cardProbe.lastSnapshot().cards)).toBe(hand);await expect(page.locator('[data-hold="0"]')).toHaveAttribute('aria-pressed','true');
  await mount(page,'github-poker');await page.locator('[data-action="start"]').click();const snapshot=await page.evaluate(()=>(window as any).cardProbe.lastSnapshot());expect(JSON.parse(snapshot.cards)[1]).toEqual(['?','?']);expect(snapshot.gameId).toBe('github-poker');
});

test('dealer ignores another game, switches accounts without redealing and releases pending animations on destroy',async({page})=>{
  await ready(page,false);await mount(page,'github-three-card');await page.evaluate(()=>(window as any).cardProbe.snapshot({gameId:'github-baccarat'}));expect(await deals(page)).toBe(0);
  await page.evaluate(()=>(window as any).cardProbe.snapshot({account:'other-account'}));expect(await deals(page)).toBe(0);
  await page.evaluate(()=>{const p=(window as any).cardProbe;p.sessions([p.session('github-three-card')]);});expect(await deals(page)).toBe(0);
  await page.evaluate(()=>{const p=(window as any).cardProbe;p.sessions([p.session('github-three-card',{phase:2,cards:['AS','KH','3C']})]);});await expect.poll(()=>deals(page)).toBe(1);await expect(page.locator('.card-being-dealt')).not.toHaveCount(0);
  const before=await page.evaluate(()=>{const p=(window as any).cardProbe;p.destroy();return p.actions.length;});await page.waitForTimeout(1000);expect(await page.evaluate(()=>(window as any).cardProbe.actions.length)).toBe(before);await expect(page.locator('[data-card-dealer]')).toHaveCount(0);
});
