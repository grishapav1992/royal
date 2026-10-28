import { expansionClient as client } from '../../src/wallet/ExpansionClient';
import { demoWallet } from '../../src/wallet/WalletClient';
import { language } from '../../src/i18n/index';
import { JACKIE_GAME, JACKIE_BETS, JACKIE_RISKS, JACKIE_COSTUMES, JACKIE_LOCATIONS, costumeUnlocked, type JackieCostume, type JackieLocation } from '../../src/shared/jackieChan';
import { penaltyPathQuote, type PenaltyRisk } from '../../src/shared/crLeo';
import { JackieScene } from './JackieScene';
import { JackieAudio } from './JackieAudio';
import './jackie.css';

const en = language === 'en';
const t = (ru:string,english:string) => en ? english : ru;
const money = (n:string|number) => (Number(n)/100).toLocaleString(en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
const opponentLabel = (n:number) => en ? `${n} ${n===1?'opponent':'opponents'}` : `${n} ${n===1?'противник':'противника'}`;
const filmName = (index:number) => en ? ['Drunken Master','Project A','Police Story','Armour of God'][index] : JACKIE_COSTUMES[index].film;
const locationName = (index:number) => en ? ['Tea House','Old Harbor','Night Market'][index] : JACKIE_LOCATIONS[index].name;
export class JackieUI {
  private root = document.createElement('section');
  readonly audio = new JackieAudio();
  readonly scene: JackieScene;
  private risk:PenaltyRisk='safe';
  private costume:JackieCostume='master';
  private location:JackieLocation='restaurant';
  private stake='1000';
  private seen='';
  private owner=client.accountId;
  private epoch=0;
  private action='';
  private error='';
  private preview=false;
  private balance='0';
  private frame=0;
  private alive=true;
  private renderKey='';
  private dialogKey='';
  private unlocks:string[]=[];
  private onChange=()=>this.sync();
  private onVisibility=()=>{if(document.hidden){this.audio.cancel();this.scene.settle();}this.renderKey='';};
  constructor(host:HTMLElement){
    this.root.className='jackie';this.root.dataset.loading='true';this.root.setAttribute('aria-label',t('Джеки Чан: Пять дублей','Jackie Chan: Five Takes'));
    this.root.innerHTML=`<header class="jc-header"><div class="jc-brand"><span>ROYAL PICTURES PRESENTS</span><strong>JACKIE <b>CHAN</b></strong><small>${t('ПЯТЬ ДУБЛЕЙ','FIVE TAKES')} <i>功夫</i></small></div><div class="jc-header-actions"><button data-wardrobe>▦ <span>${t('Костюмы','Wardrobe')}</span> <b data-count>1/4</b></button><button data-rules aria-label="${t('Правила игры','Game rules')}">?</button></div></header>
    <div class="jc-stage"><canvas aria-label="${t('Рисованная сцена боя с Джеки Чаном','Illustrated Jackie Chan fight scene')}"></canvas><div class="jc-loader" data-loader><span>ROYAL PICTURES</span><strong>${t('Готовим съёмочную площадку','Preparing the film set')}</strong><progress data-load max="8" value="0" aria-label="${t('Загрузка графики','Loading artwork')}"></progress><small data-load-label>0 / 8</small><button data-load-retry hidden>${t('Повторить загрузку','Retry artwork')}</button></div><div class="jc-scene-tag"><span>SCENE <b data-scene-no>01</b></span><strong data-scene-name></strong></div><div class="jc-risk-tag" data-risk-tag></div><div class="jc-result" data-result hidden><small data-result-caption></small><strong data-result-title></strong><span data-result-money></span></div><div class="jc-stage-bottom"><span>JACKIE CHAN <small data-film></small></span><div class="jc-takes" data-takes aria-label="${t('Пять боёв серии','Five fights in this series')}"></div></div></div>
    <div class="jc-path" data-path aria-label="${t('Возможные выплаты по серии','Possible series payouts')}"></div>
    <div class="jc-controls"><div class="jc-risk"><span class="jc-label">${t('СКОЛЬКО ИХ БУДЕТ?','HOW MANY ARE THERE?')}</span><div class="jc-risk-options">${Object.entries(JACKIE_RISKS).map(([risk,v])=>`<button data-risk="${risk}" aria-pressed="${risk==='safe'}"><span class="jc-people" aria-hidden="true">${Array.from({length:v.opponents},()=>'<i></i>').join('')}</span><b>${opponentLabel(v.opponents)}</b><small>${v.chance}% ${t('победы','success')}</small></button>`).join('')}</div><small class="jc-risk-note">${t('Шанс победить всю группу за один бой','Chance of defeating the whole group in one fight')}</small></div><div class="jc-bet"><div class="jc-bank"><label>${t('СТАВКА','STAKE')}<select data-stake aria-label="${t('Ставка в USDT','Stake in USDT')}">${JACKIE_BETS.map(n=>`<option value="${n}">${Number(n)/100} USDT</option>`).join('')}</select></label><span>${t('БАЛАНС','BALANCE')}<b data-balance>...</b><small>USDT · NILE</small></span></div><div class="jc-actions"><button class="jc-fight" data-fight>${t('МОТОР!','ACTION!')} <span>↗</span></button><button class="jc-cashout" data-cashout hidden>${t('ЗАБРАТЬ','CASH OUT')} <b data-cashout-money></b></button></div></div></div>
    <div class="jc-settings"><label>${t('ЛОКАЦИЯ','LOCATION')}<select data-location aria-label="${t('Локация боя','Fight location')}">${JACKIE_LOCATIONS.map((l,i)=>`<option value="${l.id}">${locationName(i)}</option>`).join('')}</select></label><button data-sound aria-pressed="true">♫ ${t('Звук включён','Sound on')}</button></div>
    <div class="jc-collection-line"><span data-collection-label></span><progress max="90000" value="0" data-collection-progress aria-label="${t('Прогресс коллекции костюмов','Costume collection progress')}"></progress><button data-gallery>${t('Открыть гардероб','Open wardrobe')} ↗</button></div>
    <footer class="jc-footer"><p role="status" data-status></p><span>${t('Одна ставка · До пяти боёв','One stake · Up to five fights')}</span></footer><div class="jc-recovery" data-recovery hidden><span>${t('Ответ ещё не подтверждён.','The result is not confirmed yet.')}</span><button data-retry>${t('Проверить тот же запрос','Check the same request')}</button></div><p class="jc-error" role="alert" data-error></p>
    <dialog class="jc-dialog" data-dialog><button class="jc-dialog-close" data-close aria-label="${t('Закрыть','Close')}">×</button><div data-dialog-content></div></dialog><div class="jc-unlock" role="status" data-unlock hidden></div>`;
    host.replaceChildren(this.root);this.scene=new JackieScene(this.find('canvas'),this.audio);
    this.root.addEventListener('pointerdown',()=>void this.audio.unlock(),{capture:true});this.root.addEventListener('keydown',()=>void this.audio.unlock(),{capture:true});
    this.root.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b=>b.onclick=()=>{if(this.blocked())return;this.risk=b.dataset.risk as PenaltyRisk;if(!this.active()){this.preview=true;this.scene.select(this.costume,this.location,this.risk);}this.renderKey='';this.render();});
    this.find<HTMLSelectElement>('[data-location]').onchange=e=>{if(this.active()||this.blocked())return;this.location=(e.target as HTMLSelectElement).value as JackieLocation;this.preview=true;this.scene.select(this.costume,this.location,this.risk);this.renderKey='';this.render();};
    this.find<HTMLSelectElement>('[data-stake]').onchange=e=>{if(this.active()||this.blocked())return;this.stake=(e.target as HTMLSelectElement).value;this.renderKey='';this.render();};
    this.find('[data-fight]').onclick=()=>void this.send('fight');this.find('[data-cashout]').onclick=()=>void this.send('cashout');
    this.find('[data-rules]').onclick=()=>this.openRules();this.find('[data-wardrobe]').onclick=()=>this.openWardrobe();this.find('[data-gallery]').onclick=()=>this.openWardrobe();
    this.find('[data-close]').onclick=()=>this.find<HTMLDialogElement>('[data-dialog]').close();
    this.find('[data-sound]').onclick=()=>{this.audio.toggle();this.renderKey='';this.render();};
    this.find('[data-load-retry]').onclick=()=>void this.scene.retry();this.find('[data-retry]').onclick=async()=>{try{await client.retry();}catch{}this.sync();};
    document.addEventListener('visibilitychange',this.onVisibility);client.addEventListener('change',this.onChange);demoWallet.addEventListener('change',this.onChange);
    this.sync();void client.refresh();this.frame=requestAnimationFrame(now=>this.tick(now));
  }
  private find<T extends HTMLElement=HTMLElement>(selector:string):T{return this.root.querySelector<T>(selector)!;}
  private text(selector:string,value:string){const el=this.find(selector);if(el.textContent!==value)el.textContent=value;}
  private session(){return client.sessions.find(s=>s.gameId===JACKIE_GAME);}
  private active(){return this.session()?.state==='active';}
  private blocked(){return !this.alive||!!this.action||client.busy||client.loading||!!client.pending||demoWallet.busy||!!demoWallet.pending||demoWallet.hasExternalBusy('expansion')||this.scene.state().busy;}
  private units(){return this.session()?.view.jackie?.collectionUnits??0;}
  private sync(){
    if(!this.alive)return;
    if(this.owner!==client.accountId){this.owner=client.accountId;this.epoch++;this.seen='';this.action='';this.error='';this.costume='master';this.location='restaurant';this.risk='safe';this.stake='1000';this.preview=false;this.unlocks=[];this.audio.cancel();this.scene.select(this.costume,this.location,this.risk);this.find<HTMLDialogElement>('[data-dialog]').close();}
    const s=this.session(),v=s?.view.jackie,key=v?s!.id+':'+v.combat.revision:'';
    if(v&&key!==this.seen){
      const oldUnits=Number(this.root.dataset.collection??0),animate=!!this.action&&!document.hidden;
      this.seen=key;this.costume=v.costume;this.location=v.location;this.stake=s!.stakeUnits;this.preview=false;
      if(this.action!=='cashout')this.risk=v.combat.risk;
      this.scene.show(v,animate,this.action==='cashout');
      if(animate)this.unlocks=JACKIE_COSTUMES.filter(c=>c.target>oldUnits&&c.target<=v.collectionUnits).map(c=>c.id);
      this.root.dataset.collection=String(v.collectionUnits);
    }
    this.renderKey='';this.render();
  }
  private render(){
    if(!this.alive)return;const s=this.session(),v=this.preview?undefined:s?.view.jackie,combat=v?.combat,state=this.scene.state(),active=!!this.active(),busy=this.blocked(),ready=this.scene.loading.ready;
    const key=JSON.stringify([s?.id,combat?.revision,state.reveal,state.busy,busy,ready,this.scene.loading,this.costume,this.location,this.risk,this.stake,this.units(),client.wallet?.balance,client.pending?.id,this.error,client.error,this.audio.enabled]);
    if(key===this.renderKey)return;this.renderKey=key;
    this.root.dataset.loading=String(!ready);this.root.dataset.risk=this.risk;this.root.dataset.state=s?.state??'idle';this.root.dataset.revision=String(combat?.revision??0);
    this.find('[data-loader]').hidden=ready;this.find<HTMLProgressElement>('[data-load]').max=this.scene.loading.total;this.find<HTMLProgressElement>('[data-load]').value=this.scene.loading.loaded;this.text('[data-load-label]',this.scene.loading.failed?t('Не удалось загрузить графику','Artwork could not be loaded'):`${this.scene.loading.loaded} / ${this.scene.loading.total}`);this.find('[data-load-retry]').hidden=!this.scene.loading.failed;
    const locationIndex=JACKIE_LOCATIONS.findIndex(l=>l.id===this.location);this.text('[data-scene-no]',String(locationIndex+1).padStart(2,'0'));this.text('[data-scene-name]',locationName(locationIndex));this.text('[data-risk-tag]',opponentLabel(JACKIE_RISKS[this.risk].opponents)+' · '+JACKIE_RISKS[this.risk].chance+'%');
    this.text('[data-film]',filmName(JACKIE_COSTUMES.findIndex(c=>c.id===this.costume)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b=>{b.disabled=busy;b.setAttribute('aria-pressed',String(b.dataset.risk===this.risk));});
    for(const selector of ['[data-stake]','[data-location]'])this.find<HTMLSelectElement>(selector).disabled=active||busy;
    this.find<HTMLSelectElement>('[data-stake]').value=this.stake;this.find<HTMLSelectElement>('[data-location]').value=this.location;
    const fight=this.find<HTMLButtonElement>('[data-fight]');fight.disabled=busy||!ready||!client.accountId||document.hidden||!active&&Number(this.stake)>(client.wallet?.balance??0)*100;
    fight.innerHTML=(state.busy?t('ИДЁТ СЪЁМКА','FILMING'):active?t('СЛЕДУЮЩИЙ БОЙ','NEXT FIGHT'):t('МОТОР!','ACTION!'))+' <span>↗</span>';
    const cashout=this.find<HTMLButtonElement>('[data-cashout]');cashout.hidden=!active||!state.reveal;cashout.disabled=busy||!ready||document.hidden;this.text('[data-cashout-money]',state.reveal&&combat?money(combat.availableUnits)+' USDT':'');
    const shown=state.reveal?combat?.shots??[]:(combat?.shots??[]).slice(0,-1),risks=shown.filter(s=>s.goal).map(s=>s.risk!);
    this.find('[data-takes]').innerHTML=Array.from({length:5},(_,i)=>`<i class="${shown[i]?shown[i].goal?'won':'lost':combat&&!state.reveal&&i===combat.shots.length-1?'current':''}" aria-label="${i+1}: ${shown[i]?shown[i].goal?t('победа','success'):t('поражение','loss'):t('ожидается','pending')}">${shown[i]?shown[i].goal?'✓':'×':i+1}</i>`).join('');
    this.find('[data-path]').innerHTML=Array.from({length:5},(_,i)=>{const path=risks.slice(0,i+1);while(path.length<i+1)path.push(this.risk);return `<span class="${risks.length>i?'passed':''}"><small>${t('ДУБЛЬ','TAKE')} ${i+1}</small><b>≈${(Number(penaltyPathQuote('1000000',path))/1000000).toFixed(2)}×</b></span>`;}).join('');
    const terminal=!!combat&&combat.status!=='playing'&&state.reveal,paid=terminal&&(combat.status==='banked'||combat.status==='complete');
    this.find('[data-result]').hidden=!combat||!state.reveal||state.busy&&!terminal;
    this.text('[data-result-caption]',terminal?t('СЕРИЯ ЗАВЕРШЕНА','SERIES FINISHED'):t('ГРУППА ПОБЕЖДЕНА','GROUP DEFEATED'));
    this.text('[data-result-title]',paid?combat?.status==='complete'?t('СНЯТО!','THAT’S A WRAP!'):t('ОТЛИЧНЫЙ ДУБЛЬ','A GREAT TAKE'):terminal?t('ПЕРЕСНИМЕМ?','ANOTHER TAKE?'):t('ПРОДОЛЖИМ?','KEEP GOING?'));
    this.text('[data-result-money]',paid?`${t('Выплата','Payout')} ${money(s!.returnedUnits)} USDT`:terminal?t('Выплата 0,00 USDT','Payout 0.00 USDT'):combat?`${t('Можно забрать','Available')} ${money(combat.availableUnits)} USDT`:'');
    if(state.reveal)this.balance=String(Math.round((client.wallet?.balance??0)*100));this.text('[data-balance]',client.wallet?money(this.balance):'...');
    const units=this.units(),count=JACKIE_COSTUMES.filter(c=>c.target<=units).length,next=JACKIE_COSTUMES.find(c=>c.target>units);
    this.text('[data-count]',count+'/4');this.find<HTMLProgressElement>('[data-collection-progress]').value=units;
    this.text('[data-collection-label]',next?`${t('Следующий костюм','Next costume')}: ${filmName(JACKIE_COSTUMES.indexOf(next))} · ${Math.floor(units/100)} / ${next.target/100}`:t('Все четыре костюма в коллекции','All four costumes collected'));
    this.text('[data-status]',client.busy?t('Подтверждаем действие…','Confirming action…'):!ready?t('Загружаем рисунки…','Loading artwork…'):state.busy?t('Камера, мотор!','Camera, action!'):active?t('Забери выплату или выбери следующую группу. Таймера нет.','Cash out or choose the next group. There is no timer.'):t('Выбери число противников. Первая кнопка принимает одну ставку.','Choose the group size. The first action accepts one stake.'));
    this.text('[data-sound]',this.audio.enabled?'♫ '+t('Звук включён','Sound on'):'♫ '+t('Звук выключен','Sound off'));this.find('[data-sound]').setAttribute('aria-pressed',String(this.audio.enabled));
    this.find('[data-recovery]').hidden=!client.pending||client.busy;this.find<HTMLButtonElement>('[data-retry]').disabled=client.busy||client.loading;this.text('[data-error]',this.error||client.error);
    if(this.unlocks.length&&!state.busy){this.find('[data-unlock]').hidden=false;this.text('[data-unlock]',t('Новый костюм в гардеробе: ','New costume in your wardrobe: ')+this.unlocks.map(id=>filmName(JACKIE_COSTUMES.findIndex(c=>c.id===id))).join(', '));}
  }
  getState(){return {costume:this.costume,location:this.location,risk:this.risk,collectionUnits:this.units(),assets:{...this.scene.loading},...this.scene.state(),audio:this.audio.state()};}
  private tick(now:number){if(!this.alive)return;this.scene.paint(now);this.render();this.frame=requestAnimationFrame(t=>this.tick(t));}
  private async send(move:'fight'|'cashout'){
    if(this.blocked()||!this.scene.loading.ready||!client.accountId||document.hidden||this.find<HTMLDialogElement>('[data-dialog]').open)return;
    const account=client.accountId,epoch=this.epoch,s=this.session(),v=s?.view.jackie,active=s?.state==='active';
    if(matchMedia('(max-width:640px) and (orientation:portrait)').matches)this.root.closest<HTMLElement>('.mini-stage')?.scrollTo({top:0,behavior:'instant'});
    this.error='';this.action=move;this.preview=false;this.unlocks=[];this.find('[data-unlock]').hidden=true;void this.audio.unlock();this.renderKey='';this.render();
    try{
      if(active&&v)await client.act({gameId:JACKIE_GAME,action:'move',sessionId:s.id,revision:v.combat.revision,move:move==='fight'?'jackie-fight':'cashout',...(move==='fight'?{penaltyRisk:this.risk}:{})});
      else if(move==='fight')await client.act({gameId:JACKIE_GAME,action:'start',stakeUnits:this.stake,settings:{jackie:{risk:this.risk,costume:this.costume,location:this.location}}});
    }catch(e){if(account===client.accountId&&epoch===this.epoch)this.error=(e as Error).message;}
    finally{if(this.alive&&account===client.accountId&&epoch===this.epoch){this.action='';this.sync();}}
  }
  private openRules(){
    this.find('[data-dialog-content]').innerHTML=`<small class="jc-label">ROYAL PICTURES</small><h2>${t('Пять боёв. Одна ставка.','Five fights. One stake.')}</h2><p>${t('Выбери костюм, локацию, ставку и число противников. Первая кнопка принимает ставку и проводит первый бой. После победы можно забрать доступную выплату или бесплатно продолжить серию. Поражение теряет исходную ставку и всю незабранную выплату. Пятая победа выплачивается автоматически.','Choose a costume, location, stake and group size. The first action accepts the stake and plays the first fight. After a success, cash out or continue at no extra cost. A loss forfeits the stake and all unbanked winnings. The fifth success pays automatically.')}</p><p>${t('Один противник: 75%. Два: 60%. Три: 45%. Это шанс победить всю группу за один бой. Между боями число противников можно менять. Нажатия, движения, костюмы и локации не влияют на исход.','One opponent: 75%. Two: 60%. Three: 45%. This is the chance of defeating the whole group in one fight. Change the group size between fights. Taps, movements, costumes and locations do not change the outcome.')}</p><p>${t('Расчётный возврат 99% до округления конечной выплаты вниз до 0,01 USDT. Коэффициенты приблизительные; кнопка «Забрать» показывает точную доступную сумму. Между боями нет таймера. Закрытие окна сохраняет серию. При потере ответа проверяется тот же запрос.','The theoretical return is 99% before rounding the final payment down to 0.01 USDT. Multipliers are approximate; the cashout button shows the exact available amount. There is no timer between fights. Closing the window preserves the series. A lost response is recovered using the same request.')}</p><p>${t('Костюмы открываются последовательно за сумму завершённых платных серий: 0, 160, 440 и 900 USDT. Победа и поражение дают одинаковый прогресс за одну исходную ставку. Бесплатные продолжения не добавляют прогресс. Костюм и локация сохраняются на всю принятую серию.','Costumes unlock in order at completed stake totals of 0, 160, 440 and 900 USDT. Wins and losses credit the same progress for one original stake. Free continuations add no progress. The accepted costume and location stay fixed for the series.')}</p>`;
    this.find<HTMLDialogElement>('[data-dialog]').showModal();
  }
  private openWardrobe(){
    const units=this.units(),locked=!!this.active()||this.blocked();this.dialogKey=String(units);
    this.find('[data-dialog-content]').innerHTML=`<small class="jc-label">JACKIE CHAN COLLECTION</small><h2>${t('Один Джеки. Четыре истории.','One Jackie. Four stories.')}</h2><p>${t('Костюмы по мотивам классических фильмов. Прогресс зависит от суммы завершённых ставок, независимо от исхода.','Costumes inspired by classic films. Progress comes from completed stakes, regardless of the outcome.')}</p><div class="jc-wardrobe">${JACKIE_COSTUMES.map((c,i)=>{const open=costumeUnlocked(c.id,units);return `<button class="jc-costume" data-costume="${c.id}" data-open="${open}" aria-pressed="${this.costume===c.id}" disabled><span class="jc-costume-image" style="--sheet:url('/assets/jackie-chan/${c.id}.webp')"></span><small>${c.year} · ${open?t('ОТКРЫТ','UNLOCKED'):t('ЗАКРЫТ','LOCKED')}</small><strong>${filmName(i)}</strong><span>${open?this.costume===c.id?t('Выбран','Selected'):t('Надеть костюм','Wear costume'):`${Math.floor(units/100)} / ${c.target/100} USDT`}</span></button>`;}).join('')}</div><p class="jc-wardrobe-note">${locked?t('Костюм можно менять после завершения серии.','Change costume after completing the series.'):t('Костюмы меняют только внешний вид. Шансы и выплаты одинаковые.','Costumes change appearance. Odds and payouts stay the same.')}</p>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-costume]').forEach(b=>{b.disabled=locked||!costumeUnlocked(b.dataset.costume as JackieCostume,units);b.onclick=()=>{if(this.active()||this.blocked())return;this.costume=b.dataset.costume as JackieCostume;this.preview=true;this.scene.select(this.costume,this.location,this.risk);this.find<HTMLDialogElement>('[data-dialog]').close();this.renderKey='';this.render();};});
    this.find<HTMLDialogElement>('[data-dialog]').showModal();
  }
  destroy(){this.alive=false;this.epoch++;cancelAnimationFrame(this.frame);document.removeEventListener('visibilitychange',this.onVisibility);client.removeEventListener('change',this.onChange);demoWallet.removeEventListener('change',this.onChange);this.find<HTMLDialogElement>('[data-dialog]').close();this.scene.destroy();this.audio.destroy();this.root.remove();}
}
