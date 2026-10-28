import {language,locale} from '../i18n/index';
import {DEMO_BETS} from '../shared/demoWallet';
import type {ExpansionSession} from '../shared/casinoExpansion';
import {expansionClient as client,type NewExpansionAction} from '../wallet/ExpansionClient';
import {demoWallet} from '../wallet/WalletClient';
import {observeExpansionOutcome,resetGameOutcomes} from './gameReactions';
import {gameAudio} from '../game/GameAudio';
import {LastExitScene} from './LastExitScene';
import {LastExitAudio} from './LastExitAudio';
import {raceAnchor,raceDisplay,raceHundredths,validRaceTime,type RaceAnchor} from './lastExitModel';
import type {LastExitAssetState} from './LastExitAssets';
import './last-exit.css';
import {routeProfiles} from './lastExitRoute';

const text=(ru:string,en:string)=>language==='en'?en:ru;
const money=(units:string|number)=>(Number(units)/100).toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
type Finish={id:string;value:number;returned:string};
export class LastExitUI {
 private root=document.createElement('section');private alive=true;private owner=client.accountId;private epoch=0;
 private stake='1000';private error='';private anchor?:RaceAnchor;private frame=0;
 private poll:ReturnType<typeof setInterval>;private scene:LastExitScene;private audio=new LastExitAudio();private history:Finish[]=[];
 private resultId='';private follow=false;private actionHeld=false;private media=matchMedia('(prefers-reduced-motion: reduce)');private reduced=false;
 private preferenceOff:()=>void;
 private change=()=>this.sync();
 private visibility=()=>{this.audio.silence();if(document.hidden){this.follow=false;resetGameOutcomes(this.root);cancelAnimationFrame(this.frame);this.frame=0;}else{this.anchor=undefined;void client.refresh();this.sync();}};
 private motion=()=>{this.reduced=this.media.matches;this.root.dataset.reducedMotion=String(this.reduced);};
 constructor(host:HTMLElement){
  this.reduced=this.media.matches;try{this.reduced=localStorage.getItem('royal-last-exit-reduced')==='1'||this.reduced;}catch{}
  this.root.className='last-exit';this.root.dataset.game='github-crash';this.root.setAttribute('aria-label','LAST EXIT');
  this.root.innerHTML=`<div class="le-stage"><canvas aria-label="${text('Дневная автомобильная погоня','Daytime car chase')}"></canvas><div class="le-film-grain" aria-hidden="true"></div><header class="le-title"><span class="le-eyebrow">ROYAL ORIGINALS</span><h2>LAST <em>EXIT</em></h2><p>${text('ПОСЛЕДНИЙ СЪЕЗД','ONE LAST WAY OUT')}</p></header><div class="le-live"><i></i>${text('ПОГОНЯ','PURSUIT')}<small>LOS ANGELES · 14:17</small></div><div class="le-mult"><span data-caption>${text('ТВОЙ ЗАЕЗД','YOUR RUN')}</span><strong data-value><span data-value-main>1.00</span><span data-value-fine class="le-fine" hidden>0</span><span data-value-unit>×</span></strong><p data-status>${text('У каждого заезда есть последний съезд.','Every run has one last exit.')}</p><b data-result hidden></b></div><div class="le-route"><span data-location>01 / ${text('ПРОМЗОНА','INDUSTRIAL')}</span><div><i></i><i></i><i></i><i></i></div><small>${text('ДАЛЬШЕ ЕДЕШЬ. БОЛЬШЕ РИСКУЕШЬ.','GO FURTHER. RISK MORE.')}</small></div><div class="le-speed" aria-hidden="true"><span data-speed>0</span><small>KM/H · ${text('ЭФФЕКТ','VISUAL')}</small></div><div class="le-letterbox" aria-hidden="true"></div></div><div class="le-console"><div class="le-wallet"><span>${text('USDT · NILE','USDT · NILE')}</span><strong data-balance>...</strong></div><label class="le-stake"><span>${text('СТАВКА','BET')}</span><select data-stake aria-label="${text('Ставка','Bet')}">${DEMO_BETS.map(n=>`<option value="${n*100}">${n.toLocaleString(locale)}</option>`).join('')}</select></label><button type="button" class="le-primary" data-start><span>${text('НАЧАТЬ ЗАЕЗД','START YOUR RUN')}</span><b>↗</b></button><button type="button" class="le-primary le-cashout" data-cashout hidden><span>${text('УЙТИ ОТ ПОГОНИ','TAKE THE EXIT')}<small data-cash-value></small></span><b>↗</b></button><div class="le-tools"><button type="button" data-sound aria-label="${text('Звук','Sound')}" aria-pressed="true">${text('ЗВУК','SOUND')} <span data-sound-value>ON</span></button><button type="button" data-rules>${text('ПРАВИЛА','RULES')}</button></div></div><div class="le-recovery" hidden data-recovery><span>${text('Операция ещё не подтверждена.','This operation is not confirmed yet.')}</span><button type="button" data-retry>${text('Проверить ту же операцию','Check the same operation')}</button></div><p class="le-error" role="alert"></p><footer class="le-footer"><div class="le-history" aria-label="${text('Последние заезды этого аккаунта','Recent runs for this account')}" data-history></div><button type="button" data-refresh>${text('Обновить','Refresh')}</button><span>${text('Виртуальные USDT · До 100×','Test USDT · Up to 100×')}</span></footer><dialog class="le-dialog"><button type="button" data-close aria-label="${text('Закрыть','Close')}">×</button><span class="le-eyebrow">LAST EXIT · ${text('ИНСТРУКТАЖ','BRIEFING')}</span><h3>${text('Знай свой съезд.','Know your exit.')}</h3><p>${text('Выбери ставку и начни заезд. После двухсекундного отсчёта множитель растёт. Нажми «Уйти от погони» до аварии: выплата равна ставке, умноженной на коэффициент в момент принятия запроса сервером. Если авария произошла раньше, ставка проиграна.','Choose your bet and start a run. After a two-second countdown the multiplier rises. Take the exit before the crash: the payout is your bet times the multiplier when the server accepts your request. If the crash happens first, the bet is lost.')}</p><p>${text('Коэффициент округляется вниз до сотой, сумма выплаты до 0,01 USDT. Достижение 100× оплачивается автоматически. Повтор подтверждённой операции не создаёт новую ставку или выплату.','The cashout multiplier rounds down to a hundredth and payouts to 0.01 USDT. Reaching 100× pays automatically. Repeating a confirmed operation does not create another bet or payout.')}</p><p>${text('Повороты, скорость, полиция и взрывы являются оформлением. Управления машиной нет, эффекты не сообщают будущий исход. Точку аварии определяет сервер при старте.','Turns, speed, police and explosions are presentation. There is no steering, and effects do not reveal the future outcome. The server determines the crash point at the start.')}</p><p>${text('Во время заезда коэффициент рассчитывается непрерывно между ответами сервера. Третья цифра показывает движение счётчика, сумма на кнопке приблизительная. Окончательный коэффициент и выплату подтверждает сервер. Если ответа нет 3 секунды, показ останавливается до восстановления связи. Авария при этом не откладывается. Закрытый заезд сохраняется.','During a run the multiplier is calculated continuously between server replies. The third decimal shows the counter moving; the button amount is approximate. The server confirms the final multiplier and payout. If no reply arrives for 3 seconds, the display pauses until the connection recovers. A crash is not postponed. Closed runs are saved.')}</p><p>${text('Основа Crash: расчётный возврат около 99% для фиксированных целей до округления и задержек. Это долгосрочная оценка, не обещание результата отдельного заезда.','Crash base: approximately 99% theoretical return for fixed targets before rounding and network delays. This is a long-run figure, not a promise for any individual run.')}</p><label><input type="checkbox" data-reduced ${this.reduced?'checked':''}> ${text('Уменьшить движение','Reduce motion')}</label><label>${text('Громкость','Volume')} <input type="range" min="0" max="1" step=".05" value="${gameAudio.getPreferences().volume}" data-volume></label></dialog>`;
  this.find('.le-stage').insertAdjacentHTML('beforeend',`<div class="le-loading" data-loading role="status" aria-live="polite"><span class="le-eyebrow">LAST EXIT</span><strong data-loading-title>${text('ГОТОВИМ ПОГОНЮ','PREPARING THE CHASE')}</strong><p data-loading-detail>${text('Загружаем дорогу, машины и все финалы заезда.','Loading the road, cars and every ending.')}</p><progress data-loading-progress value="0" max="16" aria-label="${text('Загрузка игры','Game loading')}"></progress><span data-loading-count>0 / 16</span><button type="button" data-loading-retry hidden>${text('Повторить загрузку','Retry loading')}</button></div>`);
  host.replaceChildren(this.root);this.scene=new LastExitScene(this.find('canvas'));this.loadHistory();this.renderHistory();
  this.find('[data-loading-retry]').onclick=()=>this.loadAssets();
  this.find<HTMLSelectElement>('[data-stake]').onchange=e=>{if(!client.busy&&!client.pending&&!this.active())this.stake=(e.target as HTMLSelectElement).value;};this.find<HTMLSelectElement>('[data-stake]').value=this.stake;
  this.find('[data-start]').onclick=()=>{void this.audio.unlock();void this.act({gameId:'github-crash',action:'start',stakeUnits:this.stake,settings:{}});};
  this.find('[data-cashout]').onclick=()=>{const s=this.session();if(s?.state==='active')void this.act({gameId:'github-crash',action:'move',sessionId:s.id,move:'cashout'});};
  this.find('[data-retry]').onclick=()=>void this.retry();this.find('[data-refresh]').onclick=()=>{this.error='';this.follow=false;resetGameOutcomes(this.root);void client.refresh();};
  this.find('[data-sound]').onclick=()=>{this.audio.setEnabled(!this.audio.isEnabled());this.soundLabel();};
  this.find('[data-rules]').onclick=()=>this.find<HTMLDialogElement>('dialog').showModal();this.find('[data-close]').onclick=()=>this.find<HTMLDialogElement>('dialog').close();
  this.find<HTMLInputElement>('[data-reduced]').onchange=e=>{this.reduced=(e.target as HTMLInputElement).checked;try{localStorage.setItem('royal-last-exit-reduced',this.reduced?'1':'0');}catch{}this.root.dataset.reducedMotion=String(this.reduced);};
  this.find<HTMLInputElement>('[data-volume]').oninput=e=>gameAudio.setVolume(Number((e.target as HTMLInputElement).value));
  this.preferenceOff=gameAudio.onPreferences(p=>{if(this.alive)this.find<HTMLInputElement>('[data-volume]').value=String(p.volume);});
  client.addEventListener('change',this.change);demoWallet.addEventListener('change',this.change);document.addEventListener('visibilitychange',this.visibility);this.media.addEventListener('change',this.motion);
  this.poll=setInterval(()=>{if(this.alive&&!document.hidden&&!client.busy&&!client.pending&&!client.loading&&this.active())void client.refresh();},350);
  this.soundLabel();this.sync();this.loadAssets();void client.refresh();
 }
 private loadAssets(){void this.scene.load(state=>this.assetState(state));}
 private assetState(state:LastExitAssetState){
  if(!this.alive)return;
  this.root.dataset.assetState=state.status;this.find('[data-loading]').hidden=state.status==='ready';
  this.find('[data-loading-title]').textContent=state.status==='error'?text('ЗАГРУЗКА ПРЕРВАЛАСЬ','LOADING INTERRUPTED'):text('ГОТОВИМ ПОГОНЮ','PREPARING THE CHASE');
  this.find('[data-loading-detail]').textContent=state.status==='error'?text('Не все ресурсы готовы. Проверь соединение и повтори загрузку.','Some resources are not ready. Check your connection and retry.'):text('Загружаем дорогу, машины и все финалы заезда.','Loading the road, cars and every ending.');
  const progress=this.find<HTMLProgressElement>('[data-loading-progress]');progress.max=state.total;progress.value=state.loaded;
  this.find('[data-loading-count]').textContent=state.loaded+' / '+state.total;this.find('[data-loading-retry]').hidden=state.status!=='error';this.sync();
 }
 private find<T extends HTMLElement=HTMLElement>(selector:string){return this.root.querySelector<T>(selector)!;}
 private session(){return client.sessions.find(s=>s.gameId==='github-crash');}
 private active(){return this.session()?.state==='active';}
 private loadHistory(){this.history=[];try{const value=JSON.parse(localStorage.getItem('royal-last-exit-history:'+this.owner)??'[]');if(Array.isArray(value))this.history=value.filter(v=>typeof v?.id==='string'&&Number.isFinite(v.value)&&v.value>=1&&v.value<=100&&typeof v.returned==='string'&&/^\d{1,15}$/.test(v.returned)).slice(0,10);}catch{}}
 private renderHistory(){const el=this.find('[data-history]');el.replaceChildren();if(!this.history.length){el.textContent=text('ТВОЯ ИСТОРИЯ НАЧИНАЕТСЯ ЗДЕСЬ','YOUR STORY STARTS HERE');return;}for(const item of this.history){const span=document.createElement('span');span.className=item.returned==='0'?'le-history-loss':'le-history-win';span.textContent=(raceHundredths(item.value,item.returned!=='0')/100).toFixed(2)+'×';span.title=(item.returned==='0'?text('Авария','Crash'):text('Выплата: ','Payout: ')+money(item.returned));el.append(span);}}
 private soundLabel(){const on=this.audio.isEnabled();this.find('[data-sound]').setAttribute('aria-pressed',String(on));this.find('[data-sound-value]').textContent=on?'ON':'OFF';}
 private sync(){
  if(!this.alive)return;
  if(this.owner!==client.accountId){this.epoch++;this.owner=client.accountId;this.anchor=undefined;this.error='';this.stake='1000';this.resultId='';this.follow=false;this.actionHeld=false;this.audio.silence();this.loadHistory();this.renderHistory();resetGameOutcomes(this.root);}
  const s=this.session(),active=s?.state==='active',balance=demoWallet.wallet?.balance??client.wallet?.balance,postBlocked=client.busy||!!client.pending||this.actionHeld||document.hidden,blocked=postBlocked||client.loading||!this.scene.ready,ready=!!client.accountId&&balance!==undefined;
  if(active&&validRaceTime(s)){
   this.anchor=raceAnchor(s,this.anchor,performance.now());
  }else this.anchor=undefined;
  this.root.dataset.sessionId=s?.id??'';this.root.dataset.state=s?.state??'idle';this.root.dataset.reducedMotion=String(this.reduced);this.root.setAttribute('aria-busy',String(!this.scene.ready||client.busy||!!client.pending||this.actionHeld));
  this.find('[data-balance]').textContent=balance===undefined?'...':money(String(Math.round(balance*100)));
  const stake=this.find<HTMLSelectElement>('[data-stake]');if(active)this.stake=s.stakeUnits;stake.value=this.stake;stake.disabled=!!active||blocked;
  const start=this.find<HTMLButtonElement>('[data-start]');start.hidden=!!active;start.disabled=blocked||!ready||Number(this.stake)>(balance??0)*100;
  start.querySelector('span')!.textContent=s?text('ЕЩЁ ОДИН ЗАЕЗД','ONE MORE RUN'):text('НАЧАТЬ ЗАЕЗД','START YOUR RUN');
  const cash=this.find<HTMLButtonElement>('[data-cashout]');cash.hidden=!active;cash.disabled=postBlocked||!ready||!s||!validRaceTime(s)||s.serverNow!<s.startedAt!;
  this.find('[data-recovery]').hidden=!client.pending||client.busy;this.find<HTMLButtonElement>('[data-retry]').disabled=client.busy||client.loading||document.hidden;
  this.find<HTMLButtonElement>('[data-refresh]').disabled=client.busy||client.loading||document.hidden;this.find('.le-error').textContent=this.error||client.error;
  if(s?.state==='settled'&&this.resultId!==s.id){this.resultId=s.id;const value=s.returnedUnits==='0'?s.crashAt??1:s.multiplier??1;this.history=[{id:s.id,value,returned:s.returnedUnits},...this.history.filter(v=>v.id!==s.id)].slice(0,10);try{localStorage.setItem('royal-last-exit-history:'+this.owner,JSON.stringify(this.history));}catch{}this.renderHistory();}
  observeExpansionOutcome(this.root,'github-crash',s,client.accountId,blocked||!this.follow||document.hidden,this.follow&&client.pending?.gameId==='github-crash');
  if(!document.hidden&&!this.frame)this.frame=requestAnimationFrame(t=>this.tick(t));
 }
 private tick(now:number){this.frame=0;if(!this.alive||document.hidden)return;const accepted=this.session(),s=client.pending?.gameId==='github-crash'&&client.pending.action==='start'&&client.pending.id!==accepted?.id?undefined:accepted,d=raceDisplay(s,this.anchor,now,this.reduced);
  this.root.dataset.motionPhase=d.phase;this.root.dataset.confirmedServerNow=String(s?.serverNow??0);this.root.dataset.displayServerNow=String(d.time);
  this.find('[data-value-main]').textContent=d.phase==='waiting'?String(d.countdown):(d.hundredths/100).toFixed(2);
  const fine=this.find('[data-value-fine]');fine.hidden=d.phase!=='racing';fine.textContent=d.phase==='racing'?String(Math.floor(d.value*1000)%10):'';this.find('[data-value-unit]').hidden=d.phase==='waiting';
  this.root.dataset.connectionState=d.stalled?'delayed':'current';
  this.find('[data-caption]').textContent=({idle:text('ТВОЙ ЗАЕЗД','YOUR RUN'),waiting:text('ДВИГАТЕЛЬ ГОТОВ','ENGINE READY'),racing:text('МНОЖИТЕЛЬ ЗАЕЗДА','RUN MULTIPLIER'),escaped:text('ТЫ УШЁЛ ОТ ПОГОНИ','YOU TOOK THE EXIT'),crashed:text('ЗАЕЗД ОКОНЧЕН','END OF THE ROAD')})[d.phase];
  this.find('[data-status]').textContent=client.pending&&!client.busy?text('Проверяем ту же операцию…','Checking the same operation…'):d.stalled||client.error?text('Связь задерживается. Проверь результат.','Connection delayed. Check your result.'):d.phase==='racing'?text('Успей уйти до аварии.','Take the exit before the crash.'):d.phase==='waiting'?text('Пристегнись.','Buckle up.'):d.phase==='escaped'?text('Выплата подтверждена. Ты ушёл от погони.','Payout confirmed. Extraction inbound.'):d.phase==='crashed'?text('Погоня закончилась аварией. Ставка проиграна.','Intercepted. The bet was lost.'):text('У каждого заезда есть последний съезд.','Every run has one last exit.');
  const result=this.find('[data-result]');result.hidden=s?.state!=='settled';if(s?.state==='settled')result.textContent=s.returnedUnits==='0'?text('ВЫПЛАТА 0,00','PAYOUT 0.00'):'+'+money(s.returnedUnits);
  const estimated=BigInt(this.stake)*BigInt(d.hundredths)/100n;this.find('[data-cash-value]').textContent='≈ '+money(estimated.toString());
  this.scene.paint(now,d.phase,d.value,this.reduced,s?.id??'');
  const stage=this.scene.locationIndex();this.find('[data-location]').textContent=String(stage+1).padStart(2,'0')+' / '+text(routeProfiles[stage].ru,routeProfiles[stage].en);this.root.style.setProperty('--le-route',String(stage));
  this.find('[data-speed]').textContent=d.phase==='racing'?(160+Math.min(140,Math.log(d.value)*45)).toFixed(1):'0';
  if(this.scene.ready)this.audio.update(d.phase,d.value,d.seconds,this.reduced,s?.id??'',this.scene.presentationSeconds());if(Math.floor(now/250)!==Number(this.root.dataset.audioSample)){this.root.dataset.audioSample=String(Math.floor(now/250));this.root.dataset.audio=JSON.stringify(this.audio.state());}
  this.frame=requestAnimationFrame(t=>this.tick(t));
 }
 private async act(op:NewExpansionAction){
  // A state read must not delay an exit. send() invalidates its stale response.
  if(!this.alive||document.hidden||client.busy||client.pending||this.actionHeld||(client.loading||!this.scene.ready)&&op.action==='start')return;
  const account=client.accountId,epoch=this.epoch;this.error='';this.follow=true;this.actionHeld=true;
  try{await client.act(op);}catch(e){if(this.alive&&account===client.accountId&&epoch===this.epoch){this.error=(e as Error).message;this.follow=false;resetGameOutcomes(this.root);}}
  finally{if(this.alive&&account===client.accountId&&epoch===this.epoch){this.actionHeld=false;this.sync();}}
 }
 private async retry(){if(document.hidden||client.busy)return;this.error='';this.follow=false;resetGameOutcomes(this.root);const account=client.accountId,epoch=this.epoch;try{await client.retry();}catch(e){if(this.alive&&account===client.accountId&&epoch===this.epoch)this.error=(e as Error).message;}if(this.alive&&account===client.accountId&&epoch===this.epoch)this.sync();}
 destroy(){this.alive=false;this.epoch++;this.follow=false;resetGameOutcomes(this.root);cancelAnimationFrame(this.frame);clearInterval(this.poll);this.audio.destroy();this.scene.destroy();this.preferenceOff();client.removeEventListener('change',this.change);demoWallet.removeEventListener('change',this.change);document.removeEventListener('visibilitychange',this.visibility);this.media.removeEventListener('change',this.motion);this.find<HTMLDialogElement>('dialog').close();this.root.remove();}
}
