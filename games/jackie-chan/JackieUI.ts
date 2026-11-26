import {canRecoverOperation} from '../../src/ui/operationFeedback';
import {ActionGameLayout} from '../../src/ui/ActionGameLayout';
import {syncStakeSelect} from '../../src/ui/stakeSelection';
import {stakeRulesHtml} from '../../src/ui/stakeRules';
import {ROYAL_GAME_STAKE_UNITS as JACKIE_BETS} from '../../src/shared/gameStakes';
import { expansionClient as client } from '../../src/wallet/ExpansionClient';
import { demoWallet } from '../../src/wallet/WalletClient';
import { language } from '../../src/i18n/index';
import { JACKIE_GAME, JACKIE_RISKS, JACKIE_COSTUMES, JACKIE_LOCATIONS, costumeUnlocked, type JackieCostume, type JackieLocation } from '../../src/shared/jackieChan';
import { penaltyPathQuote, type PenaltyRisk } from '../../src/shared/crLeo';
import { JackieScene, JACKIE_SCENE_ASSETS } from './JackieScene';
import { JackieAudio } from './JackieAudio';
import type { FightSpeed } from './JackiePlayback';
import { OPPONENT_DIFFICULTIES, opponentLineup } from './JackieOpponents';
import { JackieLayout } from './JackieLayout';
import './jackie.css';
import musicTracks from './music-sources.json';

const en = language === 'en';
const t = (ru:string,english:string) => en ? english : ru;
const money = (n:string|number) => (Number(n)/100).toLocaleString(en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
const factor = (path:PenaltyRisk[]) => (Number(penaltyPathQuote('1000000',path))/1000000).toLocaleString(en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
const opponentLabel = (n:number) => en ? `${n} ${n===1?'opponent':'opponents'}` : `${n} ${n===1?'противник':'противника'}`;
const difficultyLabel = (risk:PenaltyRisk) => en ? OPPONENT_DIFFICULTIES[risk].en : OPPONENT_DIFFICULTIES[risk].ru;
const filmName = (index:number) => en ? ['Drunken Master','Project A','Police Story','Armour of God','Rush Hour','Who Am I?','The Tuxedo','The Karate Kid'][index] : JACKIE_COSTUMES[index].film;
const locationName = (index:number) => en ? ['Tea House','Old Harbor','Night Market'][index] : JACKIE_LOCATIONS[index].name;
export class JackieUI {
  private priorities: ActionGameLayout;
  private root = document.createElement('section');
  readonly audio = new JackieAudio();
  readonly scene: JackieScene;
  private layout:JackieLayout;
  private risk:PenaltyRisk='safe';
  private costume:JackieCostume='master';
  private location:JackieLocation='restaurant';
  private stake = '10';
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
  private clapTimer=0;
  private sizes:ResizeObserver;
  private onChange=()=>this.sync();
  private onVisibility=()=>{if(document.hidden){this.audio.cancel();this.scene.settle();this.clap('');}this.renderKey='';};
  constructor(host:HTMLElement){
    this.root.className='jackie';this.root.dataset.loading='true';this.root.setAttribute('aria-label',t('Гонконгский воин','Hong Kong Warrior'));
    const tool=(name:string,label:string,body:string)=>`<button type="button" class="jc-tool" data-${name} aria-label="${label}">${body}</button>`;
    this.root.innerHTML=`<div class="jc-stage"><canvas aria-label="${t('Рисованная сцена кунг-фу','Illustrated kung fu fight scene')}"></canvas>
      <div class="jc-loader" data-loader><span>ROYAL PICTURES</span><strong>${t('Готовим съёмочную площадку','Preparing the film set')}</strong><progress data-load max="${JACKIE_SCENE_ASSETS.length}" value="0" aria-label="${t('Загрузка графики','Loading artwork')}"></progress><small data-load-label>0 / ${JACKIE_SCENE_ASSETS.length}</small><button type="button" data-load-retry hidden>${t('Повторить загрузку','Retry artwork')}</button></div>
      <div class="jc-brand"><span>ROYAL PICTURES PRESENTS</span><strong>${t('ГОНКОНГСКИЙ','HONG KONG')} <b>${t('ВОИН','WARRIOR')}</b> <i>功夫</i></strong>
        <button type="button" data-place aria-haspopup="dialog" aria-label="${t('Выбрать локацию','Choose location')}"><small>${t('СЦЕНА','SCENE')} <span data-scene-no>01</span></small><strong data-scene-name></strong><span aria-hidden="true">▾</span></button></div>
      <div class="jc-tools"><button type="button" class="jc-tool" data-wardrobe aria-label="${t('Костюмы','Wardrobe')}"><span>${t('Костюмы','Wardrobe')}</span> <b data-count>1/${JACKIE_COSTUMES.length}</b><progress max="1" value="0" data-collection-progress aria-label="${t('Прогресс коллекции костюмов','Costume collection progress')}"></progress></button>${tool('speed',t('Темп боя','Fight speed'),'')}${tool('sound',t('Звуки боя','Fight effects'),'')}${tool('music',t('Музыка локации','Location music'),'')}${tool('rules',t('Правила игры','Game rules'),'?')}</div>
      <div class="jc-result" data-result role="status" hidden><small data-result-caption></small><strong data-result-title></strong><span data-result-money></span><button type="button" data-skip-victory hidden>${t('Пропустить праздник','Skip celebration')}</button></div>
      <div class="jc-clap" data-clap="" aria-hidden="true"><i></i><div><small>${t('ДУБЛЬ','TAKE')}</small><b data-clap-take>1</b><em>${t('МОТОР!','ACTION!')}</em></div></div>
      <div class="jc-cast"><strong>${t('КАСКАДЁР','STUNTMAN')}</strong><span data-film></span></div><div class="jc-versus"><small data-versus-caption></small><span data-lineup></span></div>
      <div class="jc-notices"><div class="jc-unlock" role="status" data-unlock hidden></div><div class="jc-recovery" data-recovery hidden><span>${t('Ответ ещё не подтверждён.','The result is not confirmed yet.')}</span><button type="button" data-retry>${t('Проверить тот же запрос','Check the same request')}</button></div><p class="jc-error" role="alert" data-error></p></div></div>
    <ol class="jc-film" data-path aria-label="${t('Возможные выплаты по серии','Possible series payouts')}"></ol>
    <div class="jc-console"><div class="jc-risk"><div class="jc-risk-options" role="group" aria-label="${t('Сложность боя','Fight difficulty')}">${Object.entries(JACKIE_RISKS).map(([risk,v])=>`<button type="button" data-risk="${risk}" aria-pressed="${risk==='safe'}"><span class="jc-people" aria-hidden="true">${Array.from({length:v.opponents},()=>'<i></i>').join('')}</span><b>${difficultyLabel(risk as PenaltyRisk)}</b><small class="jc-risk-count">${opponentLabel(v.opponents)}</small><small class="jc-chance">${v.chance}% ${t('победы','success')}</small><em>×${(100/v.chance).toLocaleString(en?'en-US':'ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}</em></button>`).join('')}</div></div>
      <div class="jc-bank"><label><span>${t('СТАВКА','STAKE')}</span><select data-stake aria-label="${t('Ставка','Stake')}">${JACKIE_BETS.map(n=>`<option value="${n}">${Number(n)/100} USDT</option>`).join('')}</select></label><p><small>${t('БАЛАНС, USDT','BALANCE, USDT')}</small><b data-balance>...</b></p></div>
      <div class="jc-actions"><button type="button" class="jc-fight" data-fight><span></span><small></small></button><button type="button" class="jc-cashout" data-cashout hidden><span>${t('ЗАБРАТЬ','CASH OUT')}</span><b data-cashout-money></b></button></div></div>
    <p class="jc-spoken" role="status" data-status></p><p class="jc-spoken" data-collection-label></p>
    <dialog class="jc-dialog" data-dialog><button type="button" class="jc-dialog-close" data-close aria-label="${t('Закрыть','Close')}">×</button><div data-dialog-content></div></dialog>`;
    host.replaceChildren(this.root);
    const gear=document.createElement('button');gear.type='button';gear.dataset.options='';gear.className='jc-tool';gear.textContent='⚙';gear.setAttribute('aria-label',t('Настройки игры','Game settings'));
    this.find('.jc-tools').append(gear);
    this.priorities=new ActionGameLayout(host,this.root,gear,['speed','sound','music','rules'].map(name=>this.find(`[data-${name}]`)),t('Настройки игры','Game settings'),t('Закрыть','Close'));this.layout=new JackieLayout(host,this.root);this.scene=new JackieScene(this.find('canvas'),this.audio);
    // The hero never grows into the result card, whatever the window allows.
    const result=this.find('[data-result]');this.sizes=new ResizeObserver(()=>{this.scene.headroom=result.offsetTop+result.offsetHeight;});this.sizes.observe(result);this.sizes.observe(this.find('.jc-stage'));
    try{if(localStorage.getItem('royal-kungfu-speed')==='2')this.scene.setSpeed(2);}catch{}
    this.find('[data-speed]').onclick=()=>{const speed:FightSpeed=this.scene.state().speed===1?2:1;this.scene.setSpeed(speed);try{localStorage.setItem('royal-kungfu-speed',String(speed));}catch{}this.renderKey='';this.render();};
    const gesture=(event:Event)=>{if(!(event.target as Element).closest('[data-music]'))void this.audio.unlock();};
    this.root.addEventListener('pointerdown',gesture,{capture:true});this.root.addEventListener('keydown',gesture,{capture:true});
    this.root.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b=>b.onclick=()=>{if(this.blocked())return;this.risk=b.dataset.risk as PenaltyRisk;if(!this.active()){this.preview=true;this.scene.select(this.costume,this.location,this.risk);}this.renderKey='';this.render();});
    this.find('[data-place]').onclick=()=>this.openPlaces();
    this.find<HTMLSelectElement>('[data-stake]').onchange=e=>{if(this.active()||this.blocked())return;this.stake=(e.target as HTMLSelectElement).value;this.renderKey='';this.render();};
    this.find('[data-skip-victory]').onclick=()=>{this.scene.settle();this.renderKey='';this.render();};
    this.find('[data-fight]').onclick=()=>void this.send('fight');this.find('[data-cashout]').onclick=()=>void this.send('cashout');
    this.find('[data-rules]').onclick=()=>this.openRules();this.find('[data-wardrobe]').onclick=()=>this.openWardrobe();
    this.find('[data-close]').onclick=()=>this.find<HTMLDialogElement>('[data-dialog]').close();
    this.find('[data-sound]').onclick=()=>{this.audio.toggle();this.renderKey='';this.render();};
    this.find('[data-music]').onclick=()=>{this.audio.music.toggle();if(this.audio.music.enabled)void this.audio.unlock();this.renderKey='';this.render();};
    this.find('[data-load-retry]').onclick=()=>void this.scene.retry();this.find('[data-retry]').onclick=async()=>{try{await client.retry();}catch{}this.sync();};
    document.addEventListener('visibilitychange',this.onVisibility);client.addEventListener('change',this.onChange);demoWallet.addEventListener('change',this.onChange);
    this.sync();this.audio.prime();void client.refresh();this.frame=requestAnimationFrame(now=>this.tick(now));
  }
  private find<T extends HTMLElement=HTMLElement>(selector:string):T{return this.root.querySelector<T>(selector)!;}
  private text(selector:string,value:string){const el=this.find(selector);if(el.textContent!==value)el.textContent=value;}
  private session(){return client.sessions.find(s=>s.gameId===JACKIE_GAME);}
  private active(){return this.session()?.state==='active';}
  private blocked(){return !this.alive||!!this.action||client.busy||client.loading||!!client.pending||demoWallet.busy||!!demoWallet.pending||demoWallet.hasExternalBusy('expansion')||this.scene.state().busy;}
  private units(){return this.session()?.view.jackie?.collectionUnits??0;}
  private sync(){
    if(!this.alive)return;
    if(this.owner!==client.accountId){this.owner=client.accountId;this.epoch++;this.seen='';this.action='';this.error='';this.costume='master';this.location='restaurant';this.risk='safe';this.stake = '10';this.preview=false;this.unlocks=[];this.audio.cancel();this.audio.music.reset();this.clap('');this.scene.select(this.costume,this.location,this.risk);this.find<HTMLDialogElement>('[data-dialog]').close();}
    const s=this.session(),v=s?.view.jackie,key=v?s!.id+':'+v.combat.revision:'';
    if(v&&key!==this.seen){
      const oldUnits=Number(this.root.dataset.collection??0),animate=!!this.action&&!document.hidden;
      this.seen=key;this.costume=v.costume;this.location=v.location;this.stake=s!.stakeUnits;this.preview=false;
      if(this.action!=='cashout')this.risk=v.combat.risk;
      this.scene.show(v,animate,this.action==='cashout',s!.id);
      if(animate&&this.action!=='cashout')this.clap('shut',v.combat.shots.length);
      if(animate)this.unlocks=JACKIE_COSTUMES.filter(c=>c.target>oldUnits&&c.target<=v.collectionUnits).map(c=>c.id);
      this.root.dataset.collection=String(v.collectionUnits);
    }
    this.renderKey='';this.render();
  }
  private render(){
    if(!this.alive)return;const s=this.session(),v=this.preview?undefined:s?.view.jackie,combat=v?.combat,state=this.scene.state(),active=!!this.active(),busy=this.blocked(),ready=this.scene.loading.ready;
    this.audio.music.select(this.location);this.audio.music.duck(state.busy);
    const key=JSON.stringify([s?.id,combat?.revision,state.reveal,state.busy,state.phase,state.celebrating,state.speed,busy,ready,this.scene.loading,this.costume,this.location,this.risk,this.stake,this.units(),client.wallet?.balance,client.pending?.id,this.error,client.error,this.audio.enabled,this.audio.music.enabled]);
    if(key===this.renderKey)return;this.renderKey=key;
    this.root.dataset.loading=String(!ready);this.root.dataset.risk=this.risk;this.root.dataset.state=s?.state??'idle';this.root.dataset.revision=String(combat?.revision??0);
    this.root.dataset.speed=String(state.speed);this.root.dataset.location=this.location;this.text('[data-speed]',state.speed+'×');this.find('[data-speed]').setAttribute('aria-pressed',String(state.speed===2));
    this.find('[data-loader]').hidden=ready;this.find<HTMLProgressElement>('[data-load]').max=this.scene.loading.total;this.find<HTMLProgressElement>('[data-load]').value=this.scene.loading.loaded;this.text('[data-load-label]',this.scene.loading.failed?t('Не удалось загрузить графику','Artwork could not be loaded'):`${this.scene.loading.loaded} / ${this.scene.loading.total}`);this.find('[data-load-retry]').hidden=!this.scene.loading.failed;
    const locationIndex=JACKIE_LOCATIONS.findIndex(l=>l.id===this.location);this.text('[data-scene-no]',String(locationIndex+1).padStart(2,'0'));this.text('[data-scene-name]',locationName(locationIndex));
    this.text('[data-film]',filmName(JACKIE_COSTUMES.findIndex(c=>c.id===this.costume)));
    const nextFoes=opponentLineup(this.location,active?(combat?.shots.length??0):0,JACKIE_RISKS[this.risk].opponents);
    this.root.dataset.nextFoes=nextFoes.map(foe=>foe.id).join(',');
    this.text('[data-versus-caption]',active?t('СЛЕДУЮЩАЯ ГРУППА','NEXT GROUP'):t('ПРОТИВНИКИ','OPPONENTS'));this.text('[data-lineup]',nextFoes.map(foe=>en?foe.en:foe.ru).join(' · '));
    this.find('.jc-versus').hidden=!state.reveal||state.busy||!!this.action||client.busy;
    this.root.querySelectorAll<HTMLButtonElement>('[data-risk]').forEach(b=>{b.disabled=busy;b.setAttribute('aria-pressed',String(b.dataset.risk===this.risk));});
    this.find<HTMLSelectElement>('[data-stake]').disabled=active||busy;this.find<HTMLButtonElement>('[data-place]').disabled=active||busy;
    this.stake=syncStakeSelect(this.find<HTMLSelectElement>('[data-stake]'),this.stake,JACKIE_BETS,active||busy);
    const fight=this.find<HTMLButtonElement>('[data-fight]');fight.disabled=busy||!ready||!client.accountId||document.hidden||!active&&Number(this.stake)>(client.wallet?.balance??0)*100;
    this.text('[data-fight]>span',state.busy?t('ИДЁТ СЪЁМКА','FILMING'):active?t('СЛЕДУЮЩИЙ БОЙ','NEXT FIGHT'):combat?t('НОВЫЙ ДУБЛЬ','NEW TAKE'):t('МОТОР!','ACTION!'));
    this.text('[data-fight]>small',state.busy||this.action?'':active?t('бесплатно','free'):t('ставка ','stake ')+money(this.stake)+' USDT');
    const cashout=this.find<HTMLButtonElement>('[data-cashout]');cashout.hidden=!active||!state.reveal;this.find('.jc-actions').classList.toggle('jc-two',!cashout.hidden);cashout.disabled=busy||!ready||document.hidden||cashout.hidden;this.text('[data-cashout-money]',state.reveal&&combat?money(combat.availableUnits)+' USDT':'');
    const shown=state.reveal?combat?.shots??[]:(combat?.shots??[]).slice(0,-1),risks=shown.filter(s=>s.goal).map(s=>s.risk!);
    this.find('[data-path]').innerHTML=Array.from({length:5},(_,i)=>{const path=risks.slice(0,i+1);while(path.length<i+1)path.push(this.risk);const taken=shown[i],current=!taken&&(combat&&!state.reveal?i===combat.shots.length-1:i===shown.length&&(!combat||combat.status==='playing'));return `<li class="${taken?taken.goal?'won':'lost':current?'current':''}"><small>${t('ДУБЛЬ','TAKE')} ${i+1}${taken?taken.goal?' ✓':' ×':''}</small><b>≈${factor(path)}×</b><span>≈${money(penaltyPathQuote(this.stake,path))}<u> USDT</u></span></li>`;}).join('');
    const terminal=!!combat&&combat.status!=='playing'&&state.reveal,paid=terminal&&(combat.status==='banked'||combat.status==='complete');
    const complete=!!paid&&combat?.status==='complete',kind=!combat?'idle':!state.reveal?'pending':complete?'complete':paid?'cashout':terminal?'lost':'group';
    this.root.dataset.resultKind=kind;this.root.dataset.phase=state.phase;
    this.find('[data-result]').dataset.kind=kind;this.find('[data-result]').hidden=!combat||!state.reveal;
    this.find('[data-skip-victory]').hidden=!complete||!state.busy;
    this.text('[data-result-caption]',complete?t('ВСЕ 5 БОЁВ ПРОЙДЕНЫ','ALL 5 FIGHTS COMPLETE'):terminal?t('СЕРИЯ ЗАВЕРШЕНА','SERIES FINISHED'):`${shown.length} ${t('ИЗ','OF')} 5 · ${t('ГРУППА ПОБЕЖДЕНА','GROUP DEFEATED')}`);
    this.text('[data-result-title]',paid?combat?.status==='complete'?t('ПОБЕДА!','VICTORY!'):t('ОТЛИЧНЫЙ ДУБЛЬ','A GREAT TAKE'):terminal?t('ПЕРЕСНИМЕМ?','ANOTHER TAKE?'):t('ПОБЕДА!','VICTORY!'));
    this.text('[data-result-money]',paid?`${t('Выплата','Payout')} ${money(s!.returnedUnits)} USDT`:terminal?t('Выплата 0,00 USDT','Payout 0.00 USDT'):combat?`${t('Можно забрать','Available')} ${money(combat.availableUnits)} USDT`:'');
    if(state.reveal)this.balance=String(Math.round((client.wallet?.balance??0)*100));this.text('[data-balance]',client.wallet?money(this.balance):'...');
    const units=this.units(),count=JACKIE_COSTUMES.filter(c=>c.target<=units).length,next=JACKIE_COSTUMES.find(c=>c.target>units);
    this.text('[data-count]',count+'/'+JACKIE_COSTUMES.length);this.find<HTMLProgressElement>('[data-collection-progress]').value=Math.min(1,units/JACKIE_COSTUMES[JACKIE_COSTUMES.length-1].target);
    this.text('[data-collection-label]',next?t('Прогресс коллекции костюмов','Costume collection progress'):t('Вся коллекция костюмов открыта','All costumes collected'));
    this.text('[data-status]',client.busy?t('Подтверждаем действие…','Confirming action…'):!ready?t('Загружаем рисунки…','Loading artwork…'):state.busy?complete?t('Победа! Пять боёв пройдены, выплата подтверждена.','Victory! All five fights complete, payout confirmed.'):t('Камера, мотор!','Camera, action!'):active?t('Забери выплату или выбери следующую группу. Таймера нет.','Cash out or choose the next group. There is no timer.'):t('Выбери число противников. Первая кнопка принимает одну ставку.','Choose the group size. The first action accepts one stake.'));
    const sound=this.find('[data-sound]'),music=this.find('[data-music]');
    sound.innerHTML=`<i>♪</i> <span>${t('Звуки','Effects')}</span>`;sound.setAttribute('aria-pressed',String(this.audio.enabled));
    music.innerHTML=`<i>♫</i> <span>${t('Музыка','Music')}</span>`;music.setAttribute('aria-pressed',String(this.audio.music.enabled));music.title=this.audio.music.getState().title;
    this.find('[data-recovery]').hidden=!canRecoverOperation(client);this.find<HTMLButtonElement>('[data-retry]').disabled=client.busy||client.loading;this.text('[data-error]',this.error||client.error);
    this.find('[data-unlock]').hidden=!this.unlocks.length||state.busy;if(this.unlocks.length&&!state.busy){this.find('[data-unlock]').hidden=false;this.text('[data-unlock]',t('Новый костюм в гардеробе: ','New costume in your wardrobe: ')+this.unlocks.map(id=>filmName(JACKIE_COSTUMES.findIndex(c=>c.id===id))).join(', '));}
  }
  getState(){return {costume:this.costume,location:this.location,risk:this.risk,collectionUnits:this.units(),assets:{...this.scene.loading},...this.scene.state(),audio:this.audio.state()};}
  private tick(now:number){if(!this.alive)return;this.scene.paint(now);this.render();this.frame=requestAnimationFrame(t=>this.tick(t));}
  private async send(move:'fight'|'cashout'){
    if(this.blocked()||!this.scene.loading.ready||!client.accountId||document.hidden||this.find<HTMLDialogElement>('[data-dialog]').open)return;
    const account=client.accountId,epoch=this.epoch,s=this.session(),v=s?.view.jackie,active=s?.state==='active';
    this.error='';this.action=move;this.preview=false;this.unlocks=[];this.find('[data-unlock]').hidden=true;void this.audio.unlock();if(move==='fight')this.clap('open',active&&v?v.combat.shots.length+1:1);this.renderKey='';this.render();
    try{
      if(active&&v)await client.act({gameId:JACKIE_GAME,action:'move',sessionId:s.id,revision:v.combat.revision,move:move==='fight'?'jackie-fight':'cashout',...(move==='fight'?{penaltyRisk:this.risk}:{})});
      else if(move==='fight')await client.act({gameId:JACKIE_GAME,action:'start',stakeUnits:this.stake,settings:{jackie:{risk:this.risk,costume:this.costume,location:this.location}}});
    }catch(e){if(account===client.accountId&&epoch===this.epoch)this.error=(e as Error).message;}
    finally{if(this.alive&&account===client.accountId&&epoch===this.epoch){this.action='';this.sync();if(this.find('[data-clap]').dataset.clap==='open')this.clap('');}}
  }
  /** The clapper opens with the request and shuts with the confirmed take. It reveals nothing. */
  private clap(state:'open'|'shut'|'',take?:number){
    const el=this.find('[data-clap]');window.clearTimeout(this.clapTimer);el.dataset.clap=state;if(take)this.text('[data-clap-take]',String(take));
    if(state==='shut')this.clapTimer=window.setTimeout(()=>{if(this.alive)el.dataset.clap='';},650);
  }
  private openPlaces(){
    if(this.active()||this.blocked())return;
    this.find('[data-dialog-content]').innerHTML=`<small class="jc-label">ROYAL PICTURES</small><h2>${t('Съёмочная площадка','Film set')}</h2><div class="jc-places">${JACKIE_LOCATIONS.map((l,i)=>`<button type="button" data-location="${l.id}" aria-pressed="${l.id===this.location}"><img src="/assets/jackie-chan/${l.id}.webp" alt=""><strong>${locationName(i)}</strong></button>`).join('')}</div>`;
    this.root.querySelectorAll<HTMLButtonElement>('button[data-location]').forEach(b=>{b.onclick=()=>{this.find<HTMLDialogElement>('[data-dialog]').close();if(this.active()||this.blocked())return;this.location=b.dataset.location as JackieLocation;this.preview=true;this.scene.select(this.costume,this.location,this.risk);this.renderKey='';this.render();};});
    this.find<HTMLDialogElement>('[data-dialog]').showModal();
  }
  private openRules(){
    this.find('[data-dialog-content]').innerHTML=`<small class="jc-label">ROYAL PICTURES</small><h2>${t('Пять боёв. Одна ставка.','Five fights. One stake.')}</h2><p>${t('Выбери костюм, локацию, ставку и число противников. Первая кнопка принимает ставку и проводит первый бой. После победы можно забрать доступную выплату или бесплатно продолжить серию. Поражение теряет исходную ставку и всю незабранную выплату. Пятая победа выплачивается автоматически.','Choose a costume, location, stake and group size. The first action accepts the stake and plays the first fight. After a success, cash out or continue at no extra cost. A loss forfeits the stake and all unbanked winnings. The fifth success pays automatically.')}</p><p>${t('Один противник: 75%. Два: 60%. Три: 45%. Это шанс победить всю группу за один бой. Между боями число противников можно менять. Нажатия, движения, костюмы и локации не влияют на исход.','One opponent: 75%. Two: 60%. Three: 45%. This is the chance of defeating the whole group in one fight. Change the group size between fights. Taps, movements, costumes and locations do not change the outcome.')}</p><p>${t('Лёгкий бой: один уличный или ловкий боец. Средний: два бойца из группы ловкого бойца, громилы и телохранителя. Сложный: мастер кунг-фу, громила и телохранитель. Состав меняется между боями в пределах выбранной сложности. Шанс победить всю группу задаётся её численностью.','Easy: one street or agile fighter. Medium: two from the agile fighter, bruiser and bodyguard. Hard: the kung fu master, bruiser and bodyguard. The lineup rotates within the chosen difficulty. Group size determines the chance of defeating the whole group.')}</p><p>${t('Расчётный возврат 99%. Коэффициенты приблизительные; сумма на кнопке «Забрать» показана без долей цента, которые учитываются при завершении серии. Между боями нет таймера. Закрытие окна сохраняет серию. При потере ответа проверяется тот же запрос.','The theoretical return is 99%. Multipliers are approximate; the cashout button omits fractional cents, which are included when the series ends. There is no timer between fights. Closing the window preserves the series. A lost response is recovered using the same request.')}</p><p>${t('Костюмы открываются последовательно за сумму завершённых платных серий: 0, 160, 440, 900, 1400, 2100, 3000 и 4200 USDT. Победа и поражение дают одинаковый прогресс за одну исходную ставку. Бесплатные продолжения не добавляют прогресс. Костюм и локация сохраняются на всю принятую серию.','Costumes unlock in order at completed stake totals of 0, 160, 440, 900, 1400, 2100, 3000 and 4200 USDT. Wins and losses credit the same progress for one original stake. Free continuations add no progress. The accepted costume and location stay fixed for the series.')}</p>`;
    this.find('[data-dialog-content]').insertAdjacentHTML('beforeend',stakeRulesHtml());
    this.find('[data-dialog-content]').insertAdjacentHTML('beforeend',`<h3>${t('Музыка локаций','Location music')}</h3><p>${t('Музыка и звуки боя отключаются отдельно. Настройки сохраняются.','Music and fight effects have separate switches. Preferences are saved.')}</p><ul class="jc-music-credits">${musicTracks.map(track=>`<li><a href="${track.source}" target="_blank" rel="noopener noreferrer">${track.title}</a> · Kevin MacLeod (incompetech.com)</li>`).join('')}</ul><p><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">Creative Commons Attribution 4.0</a>. ${t('Записи нормализованы по громкости и перекодированы в MP3; полные композиции повторяются в игре.','Recordings are level-normalized and re-encoded to MP3; complete tracks loop in the game.')}</p>`);
    this.find<HTMLDialogElement>('[data-dialog]').showModal();
  }
  private openWardrobe(){
    const units=this.units(),locked=!!this.active()||this.blocked();this.dialogKey=String(units);
    this.find('[data-dialog-content]').innerHTML=`<small class="jc-label">COSTUME COLLECTION</small><h2>${t('Один герой. Восемь историй.','One hero. Eight stories.')}</h2><p>${t('Костюмы по мотивам классических фильмов. Закрытые образы раскроются после заполнения шкалы.','Costumes inspired by classic films. Locked looks are revealed when their progress bars fill.')}</p><p class="jc-collected">${this.find('[data-collection-label]').textContent}: ${JACKIE_COSTUMES.filter(c=>c.target<=units).length}/${JACKIE_COSTUMES.length}</p><div class="jc-wardrobe">${JACKIE_COSTUMES.map((c,i)=>{
      const open=costumeUnlocked(c.id,units),art=open?c.id:'master';
      return `<button class="jc-costume" data-costume="${c.id}" data-open="${open}" aria-pressed="${this.costume===c.id}" disabled><span class="jc-costume-image" style="--sheet:url('/assets/jackie-chan/${art}.webp')" aria-hidden="true"></span><small>${open?`${c.year} · ${t('ОТКРЫТ','UNLOCKED')}`:t('ЗАКРЫТ','LOCKED')}</small><strong>${open?filmName(i):t('Скрытый костюм','Mystery costume')}</strong>${open?`<span>${this.costume===c.id?t('Выбран','Selected'):t('Надеть костюм','Wear costume')}</span>`:`<progress class="jc-costume-progress" max="1" value="${Math.min(1,units/c.target)}" aria-label="${t('Прогресс открытия костюма','Costume unlock progress')} ${i+1}"></progress>`}</button>`;
    }).join('')}</div><p class="jc-wardrobe-note">${locked?t('Костюм можно менять после завершения серии.','Change costume after completing the series.'):t('Костюмы меняют только внешний вид. Шансы и выплаты одинаковые.','Costumes change appearance. Odds and payouts stay the same.')}</p>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-costume]').forEach(b=>{b.disabled=locked||!costumeUnlocked(b.dataset.costume as JackieCostume,units);b.onclick=()=>{if(this.active()||this.blocked())return;this.costume=b.dataset.costume as JackieCostume;this.preview=true;this.scene.select(this.costume,this.location,this.risk);this.find<HTMLDialogElement>('[data-dialog]').close();this.renderKey='';this.render();};});
    this.find<HTMLDialogElement>('[data-dialog]').showModal();
  }
  destroy(){this.alive=false;window.clearTimeout(this.clapTimer);this.sizes.disconnect();this.epoch++;cancelAnimationFrame(this.frame);document.removeEventListener('visibilitychange',this.onVisibility);client.removeEventListener('change',this.onChange);demoWallet.removeEventListener('change',this.onChange);this.find<HTMLDialogElement>('[data-dialog]').close();this.layout.destroy();this.scene.destroy();this.audio.destroy();this.priorities.destroy();this.root.remove();}
}
