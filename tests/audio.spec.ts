import {test,expect,type Page} from '@playwright/test';
import {selectHall} from './room-ui';
const audio=(p:Page)=>p.evaluate(()=>(window as any).royalDemo.getAudio());
test('hall, footsteps and all four arcades emit sound; mute silences the output and persists',async({page})=>{
 test.setTimeout(100000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?offline=1');await expect(page.locator('#loading')).toHaveCount(0);
 await page.keyboard.down('ArrowRight');await page.waitForTimeout(350);await page.keyboard.up('ArrowRight');
 await expect.poll(async()=>(await audio(page)).counts.step||0).toBeGreaterThan(0);
 await expect.poll(async()=>(await audio(page)).rms).toBeGreaterThan(.00001);
 await expect.poll(async()=>(await audio(page)).counts['casino-cabinet']||0,{timeout:6000}).toBeGreaterThan(0);
 for(const [id,event] of [['breaker','block'],['orbit','laser'],['drift','start'],['pixel','coin']]){
  const before=(await audio(page)).counts[event]||0;
  await page.locator('#games-tab').click();await page.locator(`[data-cabinet="${id}"]`).click();await expect(page.locator('#mini-dialog')).toBeVisible({timeout:15000});await page.locator('#start-game').click();
  if(id==='drift')await expect.poll(async()=>(await audio(page)).engine).toBe(true);
  expect((await audio(page)).casino.level).toBe(.2);
  if(id==='pixel'){await page.keyboard.down('ArrowRight');await page.waitForTimeout(350);await page.keyboard.up('ArrowRight');}
  await expect.poll(async()=>(await audio(page)).counts[event]||0,{timeout:10000}).toBeGreaterThan(before);
  await expect.poll(async()=>(await audio(page)).rms).toBeGreaterThan(.00001);
  if(id==='orbit'){
    await page.locator('#mini-dialog .settings-shortcut').click();await page.locator('#sound-enabled').uncheck();await expect.poll(async()=>(await audio(page)).muted).toBe(true);await expect.poll(async()=>(await audio(page)).rms).toBeLessThan(.000001);
    const count=(await audio(page)).counts.laser;await page.waitForTimeout(400);expect((await audio(page)).counts.laser).toBe(count);
    await page.locator('#sound-enabled').check();await expect.poll(async()=>(await audio(page)).counts.laser).toBeGreaterThan(count);await page.locator('#close-settings').click();await expect(page.locator('#mini-dialog')).toBeVisible();
  }
  await page.keyboard.press('Escape');await expect(page.locator('#mini-dialog')).toBeHidden();await expect.poll(async()=>(await audio(page)).game).toBe('');expect((await audio(page)).engine).toBe(false);expect((await audio(page)).casino.level).toBe(1);
 }
 await page.getByRole('button',{name:'Настройки игрока',exact:true}).click();await page.locator('#sound-enabled').uncheck();await expect.poll(async()=>(await audio(page)).rms).toBeLessThan(.000001);
 await page.reload();await page.locator('#loading').waitFor({state:'detached'});await page.keyboard.press('d');expect((await audio(page)).muted).toBe(true);expect((await audio(page)).volume).toBe(.35);expect(errors).toEqual([]);
});

test('casino ambience follows halls, can be disabled independently and remembers settings',async({page})=>{
 test.setTimeout(60000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?offline=1');await expect(page.locator('#loading')).toHaveCount(0);
 expect((await audio(page)).context).toBe('locked');expect((await audio(page)).muted).toBe(false);expect((await audio(page)).volume).toBe(.35);expect((await audio(page)).casinoEnabled).toBe(true);await expect(page.locator('.room-tools .audio-settings,.room-tools #mute-piano')).toHaveCount(0);
 await page.getByRole('button',{name:'Настройки игрока',exact:true}).click();
 await expect(page.getByLabel('Атмосфера казино',{exact:true})).toBeChecked();
 await expect.poll(async()=>(await audio(page)).counts['casino-reels']||0).toBeGreaterThan(0);
 await page.locator('#close-settings').click();await selectHall(page,'tables');
 await expect.poll(async()=>(await audio(page)).counts['casino-cards']||0,{timeout:6000}).toBeGreaterThan(0);
 const cabinets=(await audio(page)).counts['casino-cabinet']||0;
 await page.waitForTimeout(4600);
 expect((await audio(page)).counts['casino-cabinet']||0).toBe(cabinets);
 await page.getByRole('button',{name:'Настройки игрока',exact:true}).click();await page.getByLabel('Атмосфера казино',{exact:true}).uncheck();
 expect((await audio(page)).casino.scheduled).toBe(false);
 await expect.poll(async()=>(await audio(page)).casino.active).toBe(0);
 const counts=(await audio(page)).counts;
 await page.waitForTimeout(4700);
 for(const [key,value] of Object.entries(counts))if(key.startsWith('casino-'))expect((await audio(page)).counts[key]).toBe(value);
 expect((await audio(page)).muted).toBe(false);
 await page.locator('#sound-volume').fill('60');
 await page.reload();await expect(page.locator('#loading')).toHaveCount(0);
 await page.getByRole('button',{name:'Настройки игрока',exact:true}).click();
 await expect(page.getByLabel('Атмосфера казино',{exact:true})).not.toBeChecked();
 expect((await audio(page)).volume).toBe(.6);expect((await audio(page)).casino.scheduled).toBe(false);
 await page.getByLabel('Атмосфера казино',{exact:true}).check();
 await expect.poll(async()=>(await audio(page)).counts['casino-reels']||0).toBeGreaterThan(0);
 await page.locator('#sound-volume').fill('0');
 expect((await audio(page)).casino.scheduled).toBe(false);
 await expect.poll(async()=>(await audio(page)).rms).toBeLessThan(.000001);
 await page.locator('#sound-volume').fill('35');
 expect((await audio(page)).casino.scheduled).toBe(true);
 await page.locator('#sound-enabled').uncheck();
 expect((await audio(page)).casino.scheduled).toBe(false);
 await expect.poll(async()=>(await audio(page)).casino.active).toBe(0);
 expect(errors).toEqual([]);
});
