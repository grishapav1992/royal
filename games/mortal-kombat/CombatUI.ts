import './combat.css';
import { COMBAT_STAKES, freshCombatState, neutralCombatInput, type CombatInput } from '../../src/shared/combat';
import type { CombatView } from '../../src/shared/combatView';
import type { ActivitiesState } from '../../src/shared/activities';
import type { ActivityHostContext } from '../../src/modules/ActivityHostContract';
import type { PlayerView } from '../../src/shared/world';
import { coins, demoWallet } from '../../src/wallet/WalletClient';
import { gameAudio } from '../../src/game/GameAudio';
import { language } from '../../src/i18n/index';
const en=language==='en';
const text=(ru:string,english:string)=>en?english:ru;
const counts={"kano":{"blocking":3,"endure":3,"fall":7,"high-kick":7,"high-punch":8,"jumping":6,"stand":9,"walking":9},"subzero":{"blocking":3,"endure":3,"fall":7,"high-kick":7,"high-punch":8,"jumping":6,"stand":9,"walking":9}};
type Character=keyof typeof counts;
const imageRoot='/assets/mortal-kombat/';
export class CombatUI {
 private state:CombatView=freshCombatState();
 private root=document.createElement('section');
 private events=new AbortController();
 private input=neutralCombatInput();
 private images=new Map<string,HTMLImageElement>();
 private canvas!:HTMLCanvasElement;
 private frame=0;
 private heartbeat:ReturnType<typeof setInterval>;
 private self:string;
 private lastHit=-1;
 private settlement='';
 private assetFailed=false;
 private inputSequence=0;
 private disposed=false;
 private walletTimer?:ReturnType<typeof setTimeout>;
 constructor(host:HTMLElement,private context:ActivityHostContext){
  this.self=context.self;this.root.className='mk-game';this.root.dataset.combat='';
  this.root.innerHTML=`<header class="mk-heading"><div><small>ROYAL / PVP / 02</small><h2>MORTAL KOMBAT</h2></div><button id="shared-close" type="button" aria-label="${text('Вернуться в зал','Return to hall')}">×</button></header>
   <div class="mk-bank"><span>${text('ОБЩИЙ БАНК','PRIZE POOL')} <strong data-pot>0</strong></span><span>${text('ПОБЕДИТЕЛЮ','WINNER GETS')} <strong data-prize>0</strong></span><span>${text('КОМИССИЯ','CASINO FEE')} <strong>5%</strong></span></div>
   <div class="mk-fighters"><div><strong data-name="0"></strong><progress data-health="0" max="100" value="100" aria-label="${text('Здоровье первого игрока','Player one health')}"></progress></div><span class="mk-versus">VS</span><div><strong data-name="1"></strong><progress data-health="1" max="100" value="100" aria-label="${text('Здоровье второго игрока','Player two health')}"></progress></div></div>
   <div class="mk-arena"><canvas width="720" height="400" tabindex="0" aria-label="${text('Арена Mortal Kombat','Mortal Kombat arena')}"></canvas><div data-overlay></div><span class="mk-timer" data-timer>90</span></div>
   <p class="mk-status" data-status role="status" aria-live="polite"></p>
   <div class="mk-wager"><label>${text('Твоя ставка','Your stake')} <select data-stake aria-label="${text('Ставка на свою победу','Stake on your victory')}">${COMBAT_STAKES.map(stake=>`<option value="${stake}">${stake}</option>`).join('')}</select></label><button data-wallet-open type="button">${text('Пополнить USDT','Top up USDT')}</button><button data-ready type="button">${text('Готов: подтвердить ставку','Ready: confirm stake')}</button><button data-rematch type="button" hidden>${text('Новый бой','New fight')}</button></div>
   <div class="mk-controls" aria-label="${text('Управление боем','Fight controls')}">${[['left','←'],['right','→'],['jump','↑'],['punch',text('Удар J','Punch J')],['kick',text('Нога K','Kick K')],['block',text('Блок L','Block L')]].map(([key,label])=>`<button type="button" data-key="${key}" aria-label="${label}">${label}</button>`).join('')}</div>
   <p class="mk-rules">${text('Равные ставки из общего кошелька бесплатных виртуальных USDT. Пополнение доступно в кошельке, без перевода криптовалюты. Старт после готовности обоих. Один бой, 90 секунд. Ничья: полный возврат. Выход после старта: сдача. Обрыв связи: 20 секунд на возврат.','Equal stakes from the shared free virtual USDT wallet. Top up in the wallet without a cryptocurrency transfer. Both players must be ready. One 90-second fight. Draw: full refund. Leaving after the start forfeits the fight. Reconnect within 20 seconds.')}</p>
   <footer class="mk-footer">mk.js / Minko Gechev <span>WASD / ← ↑ → · J K L</span></footer>`;
  host.replaceChildren(this.root);
  this.root.querySelector('[data-ready]')!.parentElement!.before(this.root.querySelector('.mk-rules')!);this.canvas=this.root.querySelector('canvas')!;
  const signal=this.events.signal;
  this.root.querySelector('#shared-close')!.addEventListener('click',()=>context.onClose(),{signal});
  this.root.querySelector('[data-wallet-open]')!.addEventListener('click',()=>window.dispatchEvent(new Event('royal-open-wallet')),{signal});
  this.root.querySelector('[data-ready]')!.addEventListener('click',()=>{void gameAudio.unlock();this.send('combat-ready',{stake:this.state.stake});this.canvas.focus();},{signal});
  this.root.querySelector('[data-rematch]')!.addEventListener('click',()=>this.send('combat-rematch'),{signal});
  this.root.querySelector('[data-stake]')!.addEventListener('change',event=>this.send('combat-stake',{stake:Number((event.target as HTMLSelectElement).value)}),{signal});
  const keys:Record<string,keyof CombatInput>={KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyW:'jump',ArrowUp:'jump',KeyJ:'punch',KeyK:'kick',KeyL:'block'};
  const held=new Set<string>();
  for(const type of ['keydown','keyup'] as const)window.addEventListener(type,event=>{
   if((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return;
   const key=keys[event.code];if(!key||event.repeat)return;event.preventDefault();
   if(type==='keydown')held.add(event.code);else held.delete(event.code);
   this.input[key]=[...held].some(code=>keys[code]===key);this.pushInput();
  },{signal});
  window.addEventListener('blur',()=>{held.clear();this.release();},{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){held.clear();this.release();}},{signal});
  this.root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button=>{
   const key=button.dataset.key as keyof CombatInput;
   button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);this.input[key]=true;button.classList.add('pressed');this.pushInput();},{signal});
   for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>{this.input[key]=false;button.classList.remove('pressed');this.pushInput();},{signal});
  });
  this.loadImage('arenas/0/arena.png');
  for(const character of ['subzero','kano'] as const)for(const [action,total] of Object.entries(counts[character]))for(let i=0;i<total;i++)this.loadImage(`fighters/${character}/right/${action}/${i}.png`);
  demoWallet.addEventListener('change',()=>this.render(),{signal});void demoWallet.refresh();
  this.update(context.state);this.heartbeat=setInterval(()=>this.pushInput(),100);
  context.send({type:'join',id:'mortal-kombat'});this.draw(0);
 }
 private async refreshWallet(attempts=10){
  if(this.walletTimer)clearTimeout(this.walletTimer);
  await demoWallet.refresh();
  if(!this.disposed&&(!demoWallet.wallet||demoWallet.error)&&attempts>0)this.walletTimer=setTimeout(()=>{void this.refreshWallet(attempts-1);},500);
 }
 private send(type:string,extra:Record<string,unknown>={}){this.context.send({type,match:this.state.id,...extra});}
 private pushInput(){if(this.state.phase==='playing'||this.state.phase==='countdown')this.send('combat-input',{seq:++this.inputSequence,input:{...this.input}});}
 private release(){this.input=neutralCombatInput();this.root.querySelectorAll('.pressed').forEach(button=>button.classList.remove('pressed'));this.pushInput();}
 private loadImage(path:string){const img=new Image();img.onload=()=>this.render();img.src=imageRoot+path;img.onerror=()=>{this.assetFailed=true;this.render();};this.images.set(path,img);}
 update(state:ActivitiesState){
  const old=this.state;this.state=state.combat??this.state;const s=this.state;
  if(s.id!==old.id)this.inputSequence=0;
  this.inputSequence=Math.max(this.inputSequence,s.fighters[s.players.indexOf(this.self)]?.inputSequence??0);
  const settlement=s.id+':'+s.phase;
  if(settlement!==this.settlement&&(s.phase==='countdown'||s.phase==='finished')){this.settlement=settlement;void this.refreshWallet();}
  if(this.lastHit>=0&&s.id===old.id&&s.hitSeq!==this.lastHit&&!document.hidden)gameAudio.effect('hit',.45);
  this.lastHit=s.hitSeq;
  this.render();
 }
 updatePlayers(_players:PlayerView[],self:string){this.self=self;this.render();}
 private render(){
  const s=this.state,side=s.players.indexOf(this.self),ownReady=s.ready.includes(this.self),q=(selector:string)=>this.root.querySelector<HTMLElement>(selector)!;
  q('[data-pot]').textContent=coins(s.pot||s.stake*2)+' USDT · '+text('Демо','Demo');
  q('[data-prize]').textContent=coins(s.phase==='finished'?s.payout:s.stake*1.9)+' USDT · '+text('Демо','Demo');
  for(let i=0;i<2;i++){
   q('[data-name="'+i+'"]').textContent=(s.names[i]??text('Свободное место','Open seat'))+(s.players[i]===this.self?text(' · ты',' · you'):'')+(s.ready.includes(s.players[i])?' ✓':'');
   (q('[data-health="'+i+'"]') as HTMLProgressElement).value=s.fighters[i]?.health??100;
  }
  const stake=q('[data-stake]') as HTMLSelectElement;stake.value=String(s.stake);stake.disabled=s.phase!=='waiting'||side<0;
  const ready=q('[data-ready]') as HTMLButtonElement;const wallet=demoWallet.wallet,available=!!wallet&&!demoWallet.busy&&!demoWallet.pending&&!demoWallet.externalBusy&&wallet.balance>=s.stake;
  ready.disabled=!available||this.assetFailed||![...this.images.values()].every(img=>img.complete&&img.naturalWidth>0)||side<0||s.players.length<2||s.phase!=='waiting'||ownReady;
  ready.textContent=ownReady?text('Ты готов','You are ready'):text('Готов: поставить ','Ready: stake ')+coins(s.stake)+' USDT · '+text('Демо','Demo');
  q('[data-rematch]').hidden=s.phase!=='finished'||side<0;
  const status=s.phase==='finished'?(s.winner?text('Победил ','Winner: ')+s.winnerName+text('. Выплата: ','. Payout: ')+coins(s.payout)+text(' · Комиссия: ',' · Fee: ')+coins(s.fee):text('Ничья или отмена. Ставки возвращены.','Draw or cancelled. Stakes refunded.')):s.phase==='waiting'?(s.message||(s.players.length<2?text('Ждём второго игрока','Waiting for the second player'):text('Подтвердите одинаковые ставки и готовность','Confirm equal stakes and readiness'))):s.phase==='funding'?text('Проверяем ставки','Checking stakes'):s.phase==='settling'?text('Подтверждаем выплату','Confirming payout'):text('Снизь здоровье соперника до нуля.','Reduce your opponent’s health to zero.');
  q('[data-status]').textContent=s.phase==='waiting'&&!available?(demoWallet.pending||demoWallet.externalBusy?text('Сначала проверь предыдущую операцию в кошельке.','Check the previous wallet operation first.'):wallet&&wallet.balance<s.stake?text('Пополни бесплатные виртуальные USDT, чтобы подтвердить ставку.','Top up free virtual USDT to confirm your stake.'):text('Проверяем общий игровой баланс USDT.','Checking the shared game USDT balance.')):this.assetFailed?text('Не удалось загрузить графику. Переоткрой автомат.','Graphics failed to load. Reopen the cabinet.'):status;
  q('[data-overlay]').textContent=s.phase==='countdown'?String(Math.ceil(s.countdown)):s.phase==='waiting'?text('ВЫЗОВ ПРИНЯТ?','ACCEPT THE CHALLENGE?'):s.phase==='finished'?(s.winner?'FINISH':'DRAW'):s.phase==='settling'?text('РАСЧЁТ','SETTLING'):'';
  q('[data-timer]').textContent=String(Math.ceil(s.remaining));
 }
 private draw(time:number){
  this.frame=requestAnimationFrame(t=>this.draw(t));const c=this.canvas.getContext('2d')!,s=this.state;
  c.fillStyle='#121a23';c.fillRect(0,0,720,400);
  const background=this.images.get('arenas/0/arena.png');if(background?.complete&&background.naturalWidth)c.drawImage(background,0,0,720,400);
  c.fillStyle='#07091255';c.fillRect(0,0,720,400);
  const fs=s.fighters.length?s.fighters:[{x:240,y:0,action:'stand'},{x:480,y:0,action:'stand'}];
  fs.forEach((f,index)=>{
   const character:Character=index?'kano':'subzero',action=f.action as keyof typeof counts[Character];
   const total=counts[character][action]??1,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
   const n=reduce?0:Math.floor(time/95)%total,img=this.images.get(`fighters/${character}/right/${action}/${n}.png`);
   c.fillStyle='#0007';c.beginPath();c.ellipse(f.x,375,45,8,0,0,Math.PI*2);c.fill();
   if(img?.complete&&img.naturalWidth){c.save();c.translate(f.x,373-f.y);if(index)c.scale(-1,1);const scale=1.65;c.drawImage(img,-img.naturalWidth*scale/2,-img.naturalHeight*scale,img.naturalWidth*scale,img.naturalHeight*scale);c.restore();}
  });
 }
 getState(){return{combat:this.state,charge:{charging:false,power:550},hockey:{local:null,rendered:[],puck:null,radius:0},frames:0};}
 hallChanged(){this.context.onClose();}
 destroy(){this.disposed=true;if(this.walletTimer)clearTimeout(this.walletTimer);for(const img of this.images.values()){img.onload=null;img.onerror=null;}this.release();clearInterval(this.heartbeat);cancelAnimationFrame(this.frame);this.events.abort();this.root.remove();}
}
