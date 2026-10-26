import { randomInt } from 'node:crypto';
import type { PostgresDatabase } from './database';
import { EXPANSION_GAMES, EXPANSION_NAMES, expansionRulesVersion, validExpansionRulesVersion, validExpansionAction, type ExpansionAction, type ExpansionGameId, type ExpansionSession, type ExpansionView } from '../src/shared/casinoExpansion';
import { DEMO_BETS, type DemoWallet } from '../src/shared/demoWallet';
import { WalletError } from './demoWallet';
import { demoBalanceUnits, demoReservedUnits, MAX_DEMO_UNITS, recordDemoUnits, saveDemoUnits } from './demoWalletAmounts';
import { cardEngine, type CardReply } from './games/cardEngine';
import { deal } from './games/rush/diamonds';
import { isVariantGame, VARIANT_MAX, type VariantSettings } from '../src/shared/casinoVariants';
import { startVariant, moveVariant, VariantMoveError, type VariantResult } from './games/casinoVariants';
import { multiplierAtElapsed, rollCrashPoint, secondsToReachMultiplier } from './games/rush/crash';
import { STUDIO_MAX, isStudioGame, validStudioSettlement, type StudioSettings } from '../src/shared/studioGames';
import { startStudioGame, moveStudioGame, StudioMoveError, type StudioResult } from './games/studioGames';

export type ExpansionState = ExpansionSession & {createdAt:number;engine?:unknown;settings:Extract<ExpansionAction,{action:'start'}>['settings'];crashPoint?:number};
const CARDS:Partial<Record<ExpansionGameId,string>> = {'github-three-card':'three-card','github-caribbean':'caribbean','github-let-it-ride':'let-it-ride','github-ultimate':'ultimate','github-war':'war','github-red-dog':'red-dog','github-pai-gow':'pai-gow','github-dragon-tiger':'dragon-tiger','github-deuces':'deuces','github-mississippi':'mississippi','github-four-card':'four-card','github-crazy-four':'crazy-four','github-flush':'flush','github-holdem-bonus':'holdem-bonus','github-oasis':'oasis','github-russian':'russian','github-caribbean-draw':'caribbean-draw','github-spanish':'spanish','github-exposure':'exposure','github-switch':'switch','github-free-bet':'free-bet','github-rummy':'rummy','github-andar-bahar':'andar-bahar'};
export const EXPANSION_MAX:Record<ExpansionGameId,number> = {...STUDIO_MAX,...VARIANT_MAX,'github-diamonds':30,'github-crash':100,'github-three-card':55,'github-caribbean':205,'github-let-it-ride':3003,'github-ultimate':570,'github-war':3,'github-red-dog':24,'github-pai-gow':2,'github-dragon-tiger':2,'github-deuces':800,'github-sic-bo':2,'github-mississippi':5010,'github-four-card':40,'github-crazy-four':300,'github-flush':10,'github-holdem-bonus':1010,'github-oasis':205,'github-russian':205,'github-caribbean-draw':105,'github-spanish':64,'github-exposure':64,'github-switch':10,'github-free-bet':16,'github-rummy':20,'github-andar-bahar':2};
export const expansionMax = (game:ExpansionGameId,version:1|2) => version===2&&game==='github-holdem-bonus'?10:version===2&&game==='github-rummy'?13:EXPANSION_MAX[game];
export function expansionInitialCost(game:ExpansionGameId,side=false){return ['github-crazy-four','github-switch'].includes(game)?2:game==='github-let-it-ride'?3:game==='github-ultimate'?2+Number(side):game==='github-three-card'?1+Number(side):1;}
const emptyView=():ExpansionView=>({player:[],dealer:[],community:[],actions:[],phase:1,ended:false,message:''});
const placeholders=EXPANSION_GAMES.map(()=>'?').join(',');
export class DemoExpansionStore {
  constructor(private db:PostgresDatabase,private snapshot:(id:string)=>Promise<DemoWallet>,readonly ready:Promise<void>,private settleOther:(id:string)=>Promise<void>,
    private draw:(max:number)=>number=randomInt,private now:()=>number=Date.now,private cards=cardEngine,private crashRoll=rollCrashPoint){}
  private units(s:ExpansionState,chips:number,scale=1000){const units=Number(BigInt(s.stakeUnits)*BigInt(chips)/BigInt(scale));if(!Number.isSafeInteger(units)||units<0)throw Error('Invalid expansion amount');return units;}
  private public(s:ExpansionState):ExpansionSession {
    const {engine:_,settings:__,createdAt:___,crashPoint:____,...result}=structuredClone(s);
    if(s.gameId==='github-crash'){
      result.serverNow=this.now();result.multiplier=s.state==='active'?Math.min(100,multiplierAtElapsed(Math.max(0,(this.now()-s.startedAt!)/1000))):s.multiplier;
      if(s.state==='settled')result.crashAt=s.crashPoint;
      result.view.actions=s.state==='active'?[{move:'cashout',label:'Забрать выплату',cost:0}]:[];
    }
    return result;
  }
  private async save(account:string,s:ExpansionState){
    const reserve=s.state==='active'?Math.max(0,Number(s.stakeUnits)*expansionMax(s.gameId,s.rulesVersion)-Number(s.returnedUnits)):0;
    await this.db.prepare('UPDATE demo_casino_sessions SET state=?,payload=?,reserved_units=? WHERE account_id=? AND id=?').run(s.state,JSON.stringify(s),reserve,account,s.id);
  }
  private async money(account:string,s:ExpansionState,id:string,debit:number,credit:number,kind:'win'|'refund'='win'){
    let balance=await demoBalanceUnits(this.db,account);if(balance<debit)throw new WalletError(409,'Недостаточно демомонет для этого хода.');
    if(credit>Number(s.stakeUnits)*expansionMax(s.gameId,s.rulesVersion))throw Error('Expansion payout exceeds reserve');
    if(debit){balance-=debit;s.spentUnits=(BigInt(s.spentUnits)+BigInt(debit)).toString();await recordDemoUnits(this.db,account,id,'bet',-debit,balance,s.gameId,EXPANSION_NAMES[s.gameId]);}
    if(credit||s.state==='settled'){balance+=credit;s.returnedUnits=(BigInt(s.returnedUnits)+BigInt(credit)).toString();await recordDemoUnits(this.db,account,id,kind,credit,balance,s.gameId,EXPANSION_NAMES[s.gameId]);}
    if(isStudioGame(s.gameId)&&!validStudioSettlement(s.gameId,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.studio))throw Error('Invalid studio settlement');
    await this.save(account,s);await saveDemoUnits(this.db,account,balance);
  }
  private async crashDue(account:string,now:number){
    const row=await this.db.prepare("SELECT payload FROM demo_casino_sessions WHERE account_id=? AND game_id='github-crash' AND state='active'").get(account);
    if(!row)return;const s=JSON.parse(row.payload) as ExpansionState;
    const deadline=s.startedAt!+secondsToReachMultiplier(s.crashPoint!)*1000;
    if(now<deadline)return;
    s.state='settled';s.multiplier=s.crashPoint===100?100:0;s.view.ended=true;s.view.actions=[];s.view.message=s.crashPoint===100?'Достигнуто 100×':'Полёт остановился';
    await this.money(account,s,s.id,0,s.crashPoint===100?Number(s.stakeUnits)*100:0);
  }
  async settleDue(account:string){await this.ready;await this.db.transaction(()=>this.crashDue(account,this.now()),{lockKey:'account:'+account});}
  private async sessions(account:string){
    const rows=await this.db.prepare(`SELECT DISTINCT ON(game_id) payload FROM demo_casino_sessions WHERE account_id=? AND game_id IN (${placeholders}) ORDER BY game_id,(payload::jsonb->>'createdAt')::bigint DESC,id DESC`).all(account,...EXPANSION_GAMES);
    return rows.map(row=>this.public(JSON.parse(row.payload)));
  }
  async active(account:string){await this.ready;return this.db.transaction(async()=>{await this.settleOther(account);await this.crashDue(account,this.now());return {wallet:await this.snapshot(account),sessions:await this.sessions(account)};},{lockKey:'account:'+account});}
  private applyCards(s:ExpansionState,r:CardReply){
    if(r.error)throw new WalletError(409,'Этот ход недоступен. Проверь выбранные карты и текущий этап игры.');
    s.engine=r.payload;s.view=r.view;s.state=r.view.ended?'settled':'active';
    s.view.actions=s.view.actions.map(action=>({...action,cost:this.units(s,action.cost,r.scale),...(action.perPick?{perPick:this.units(s,action.perPick,r.scale)}:{})}));
    return {debit:this.units(s,r.debit,r.scale),credit:this.units(s,r.credit,r.scale)};
  }
  private applyVariant(s:ExpansionState,result:VariantResult){
    s.engine=result.engine;s.state=result.ended?'settled':'active';
    const variant=result.variant;let actions:ExpansionView['actions']=[],phase=1;
    if(!result.ended){
      if(variant.kind==='mines'){phase=variant.opened.length+1;actions=[{move:'reveal',label:'Открыть ячейку',cost:0,minPicks:1,maxPicks:1},...(variant.opened.length?[{move:'cashout',label:'Забрать выплату',cost:0}]:[])];}
      else if(variant.kind==='color'){phase=variant.steps+1;actions=[{move:'red',label:'Красное',cost:0},{move:'black',label:'Чёрное',cost:0},...(variant.steps?[{move:'cashout',label:'Забрать выплату',cost:0}]:[])];}
      else if(variant.kind==='keys'){phase=variant.steps+1;actions=[{move:'unlock',label:'Открыть два замка',cost:0,minPicks:2,maxPicks:2},...(variant.steps?[{move:'cashout',label:'Забрать выплату',cost:0}]:[])];}
      else if(variant.kind==='double-mines'){phase=variant.steps+1;actions=[{move:'reveal',label:'Открыть пару',cost:0,minPicks:2,maxPicks:2},...(variant.steps?[{move:'cashout',label:'Забрать выплату',cost:0}]:[])];}
      else if(variant.kind==='dice-streak'){phase=variant.steps+1;actions=[{move:'roll',label:'Бросить кость',cost:0,minPicks:1,maxPicks:1},...(variant.steps?[{move:'cashout',label:'Забрать выплату',cost:0}]:[])];}
      else throw Error('Unexpected active variant');
    }
    s.view={...emptyView(),variant,ended:result.ended,message:result.message,phase,actions};
    return {debit:0,credit:result.credit};
  }
  private applyStudio(s:ExpansionState,result:StudioResult){
    s.engine=result.engine;s.state=result.ended?'settled':'active';const studio=result.studio;let actions:ExpansionView['actions']=[],phase=1;
    if(!result.ended){
      if(studio.kind==='slot'){phase=studio.step+1;actions=[{move:'studio-spin',label:studio.stage==='hold'?'Бесплатный повтор':'Продолжить бесплатный бонус',cost:0}];}
      else if(studio.kind==='crash'||studio.kind==='flight'){phase=studio.steps+1;actions=[{move:'studio-advance',label:'Следующий этап',cost:0},...(studio.steps?[{move:'cashout',label:'Забрать выплату',cost:0}]:[])];}
      else if(studio.kind==='mines'){phase=studio.steps+1;actions=[{move:'reveal',label:'Открыть ячейку',cost:0,minPicks:1,maxPicks:1},...(studio.steps?[{move:'cashout',label:'Забрать выплату',cost:0}]:[])];}
      else throw Error('Unexpected active studio game');
    }
    s.view={...emptyView(),studio,ended:result.ended,message:result.message,phase,actions};return {debit:0,credit:result.credit};
  }
  async operate(account:string,value:unknown,clientRules:1|2=2){
    await this.ready;if(!validExpansionAction(value))throw new WalletError(400,'Некорректное действие казино.');
    const op=structuredClone(value),key=JSON.stringify(op);
    if(op.action==='start'&&!(DEMO_BETS as readonly number[]).some(n=>String(n*100)===op.stakeUnits))throw new WalletError(400,'Недопустимая ставка.');
    return this.db.transaction(async()=>{
      await this.settleOther(account);const at=this.now();await this.crashDue(account,at);
      const old=await this.db.prepare('SELECT * FROM demo_casino_requests WHERE account_id=? AND id=?').get(account,op.id);
      if(old){if(old.request_key!==key)throw new WalletError(409,'Нельзя изменить отправленный ход.');const row=await this.db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get(account,old.session_id);return {wallet:await this.snapshot(account),session:this.public(JSON.parse(row!.payload)),sessions:await this.sessions(account),replayed:true};}
      for(const table of ['demo_operations','demo_mines_requests','demo_flight_requests']){if(await this.db.prepare(`SELECT 1 FROM ${table} WHERE account_id=? AND ${table==='demo_operations'?'operation_id':'id'}=?`).get(account,op.id))throw new WalletError(409,'Этот номер операции уже использован.');}
      const recent=await this.db.prepare('SELECT count(*) AS n FROM (SELECT 1 FROM demo_casino_requests WHERE account_id=? AND created_at>? LIMIT 120) recent').get(account,this.now()-60000);
      if(Number(recent!.n)>=120)throw new WalletError(429,'Слишком много ходов. Подожди минуту.');
      let s:ExpansionState,debit=0,credit=0;
      if(op.action==='start'){
        if(expansionRulesVersion(op.gameId)===2&&clientRules!==2)throw new WalletError(409,'Обнови страницу: правила этой игры исправлены. Ставка не списана.');
        if(await this.db.prepare("SELECT 1 FROM demo_casino_sessions WHERE account_id=? AND game_id=? AND state='active'").get(account,op.gameId))throw new WalletError(409,'Сначала заверши текущую партию.');
        const stake=Number(op.stakeUnits),balance=await demoBalanceUnits(this.db,account),cost=stake*expansionInitialCost(op.gameId,('side' in op.settings?op.settings.side:false));
        if(balance<cost)throw new WalletError(409,'Недостаточно демомонет для начальных ставок.');
        if(balance-cost+stake*expansionMax(op.gameId,expansionRulesVersion(op.gameId))+await demoReservedUnits(this.db,account)>MAX_DEMO_UNITS)throw new WalletError(409,'Уменьши ставку: возможный выигрыш превышает лимит баланса.');
        // Keep committed round order when the clock repeats or moves backwards.
        const last=await this.db.prepare("SELECT MAX((payload::jsonb->>'createdAt')::bigint) AS created_at FROM demo_casino_sessions WHERE account_id=? AND game_id=?").get(account,op.gameId);
        const createdAt=Math.max(this.now(),Number(last!.created_at??-1)+1);
        if(!Number.isSafeInteger(createdAt)||createdAt<0)throw Error('Invalid casino session order');
        s={id:op.id,gameId:op.gameId,rulesVersion:expansionRulesVersion(op.gameId),state:'active',stakeUnits:op.stakeUnits,spentUnits:'0',returnedUnits:'0',createdAt,settings:op.settings,view:emptyView()};debit=cost;
        if(isStudioGame(op.gameId)){
          credit=this.applyStudio(s,startStudioGame(op.gameId,op.settings as StudioSettings,op.stakeUnits,this.draw)).credit;
        }else if(isVariantGame(op.gameId)){
          credit=this.applyVariant(s,startVariant(op.gameId,op.settings as VariantSettings,op.stakeUnits,this.draw)).credit;
        }else if(CARDS[op.gameId]){
          const move=op.gameId==='github-dragon-tiger'?'start-'+('bet' in op.settings?op.settings.bet:undefined):'start';
          const r=await this.cards(CARDS[op.gameId]!,move,undefined,undefined,('side' in op.settings?op.settings.side:false),s.rulesVersion);({debit,credit}=this.applyCards(s,r));
          if(debit!==cost)throw Error('Card start debit differs from expected stake');
        }else if(op.gameId==='github-diamonds'){
          const result=deal(this.draw);s.gems=result.hand;s.multiplier=result.multiplier;s.state='settled';s.view.ended=true;credit=stake*result.multiplier;
        }else if(op.gameId==='github-sic-bo'){
          s.dice=Array.from({length:3},()=>this.draw(6)+1);const [a,b,c]=s.dice,sum=a+b+c;
          const won=!(a===b&&b===c)&&(('bet' in op.settings?op.settings.bet:undefined)==='small'?sum>=4&&sum<=10:sum>=11&&sum<=17);
          credit=won?stake*2:0;s.state='settled';s.view.ended=true;s.view.message='Сумма костей: '+sum;
        }else{
          const point=this.crashRoll();if(!Number.isFinite(point)||point<1)throw Error('Invalid crash point');s.crashPoint=Math.min(100,point);s.startedAt=this.now()+2000;
        }
        await this.db.prepare('INSERT INTO demo_casino_sessions VALUES(?,?,?,?,?,?)').run(account,s.id,s.gameId,s.state,JSON.stringify(s),0);
      }else{
        const row=await this.db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=? AND game_id=?').get(account,op.sessionId,op.gameId);
        if(!row)throw new WalletError(404,'Партия не найдена.');s=JSON.parse(row.payload);
        if(!validExpansionRulesVersion(s.gameId,s.rulesVersion))throw Error('Unknown saved casino rules version');
        if(s.state!=='active'){
          if(s.gameId==='github-crash'&&op.move==='cashout'){
            await this.db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)').run(account,op.id,key,s.id,at);
            return {wallet:await this.snapshot(account),session:this.public(s),sessions:await this.sessions(account),replayed:false};
          }
          throw new WalletError(409,'Эта партия уже завершена.');
        }
        if(!s.view.actions.some(action=>action.move===op.move)&&s.gameId!=='github-crash')throw new WalletError(409,'Этот ход недоступен на текущем этапе.');
        const offered=s.view.actions.find(action=>action.move===op.move);const count=op.picks?.length??0;
        if(!isVariantGame(s.gameId)&&!isStudioGame(s.gameId)&&offered?.maxPicks!==undefined&&(count<(offered.minPicks??0)||count>offered.maxPicks||(op.picks??[]).some(i=>i>=s.view.player.length)))throw new WalletError(409,'Выбери допустимое количество карт.');
        const required=(offered?.cost??0)+(offered?.perPick??0)*count;if(await demoBalanceUnits(this.db,account)<required)throw new WalletError(409,'Недостаточно демомонет для этого хода.');
        if(isStudioGame(s.gameId)){
          try{({debit,credit}=this.applyStudio(s,moveStudioGame(s.gameId,s.engine,op.move,op.picks,s.stakeUnits)));}
          catch(error){if(error instanceof StudioMoveError)throw new WalletError(409,error.message);throw error;}
          if(debit!==required)throw Error('Studio debit differs from offered action');
        }else if(isVariantGame(s.gameId)){
          try{({debit,credit}=this.applyVariant(s,moveVariant(s.gameId,s.engine,op.move,op.picks,s.stakeUnits)));}
          catch(error){if(error instanceof VariantMoveError)throw new WalletError(409,error.message);throw error;}
          if(debit!==required)throw Error('Variant debit differs from offered action');
        }else if(s.gameId==='github-crash'){
          if(op.move!=='cashout'||at<s.startedAt!)throw new WalletError(409,'Дождись начала полёта.');
          // The account transaction locks the deadline check and the single credit.
          const deadline=s.startedAt!+secondsToReachMultiplier(s.crashPoint!)*1000;if(at>=deadline)throw new WalletError(409,'Полёт уже остановился.');
          const cents=Math.floor(Math.min(100,multiplierAtElapsed((at-s.startedAt!)/1000))*100);
          credit=Number(BigInt(s.stakeUnits)*BigInt(cents)/100n);s.multiplier=cents/100;s.state='settled';s.view.ended=true;s.view.actions=[];
        }else{({debit,credit}=this.applyCards(s,await this.cards(CARDS[s.gameId]!,op.move,s.engine,op.picks,false,s.rulesVersion)));if(debit!==required)throw Error('Card debit differs from offered action');}
      }
      await this.money(account,s,op.id,debit,credit,op.action==='move'&&op.move==='pull'?'refund':'win');
      await this.db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)').run(account,op.id,key,s.id,this.now());
      return {wallet:await this.snapshot(account),session:this.public(s),sessions:await this.sessions(account),replayed:false};
    },{lockKey:'account:'+account});
  }
}
