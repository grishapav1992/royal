import {DRACONA_GAME,DRACONA_MAX_WIN,validDraconaStake,validDraconaSettlement,type DraconaSettings,type DraconaResult} from '../src/shared/dracona';
import {startDracona,moveDracona,DraconaMoveError} from './games/dracona';
import { PENALTY_GAME, PENALTY_MAX, validPenaltySettlement, type PenaltySettings, type PenaltyView } from '../src/shared/crLeo';
import { startPenalty, movePenalty, PenaltyMoveError } from './games/crLeo';
import { LastExitCashoutDelay } from './lastExitCashoutDelay';
import {type ConvoyProgress,validConvoyProgress} from '../src/shared/convoyWardrobe';
import {MEME_GAME,isNitroFamily} from '../src/shared/memeOverload';
import {AfterglowWardrobeStore} from './afterglowWardrobe';
import {AFTER_GAME,AFTER_MAX_WIN,validAfterStake,validAfterSettlement,type AfterSettings,type AfterResult} from '../src/shared/afterglow';
import {startAfter,moveAfter,AfterMoveError} from './games/afterglow';
import {NITRO_GAME,NITRO_MAX_WIN,validNitroStake,validNitroSettings,validNitroSettlement,type NitroSettings,type NitroResult} from '../src/shared/nitroRun';
import {startNitro,moveNitro,NitroMoveError} from './games/nitroRun';
import {CONVOY_GAME,CONVOY_MAX_WIN,validConvoyStake,validConvoySettings,validConvoySettlement,type ConvoySettings,type ConvoyResult} from '../src/shared/lastConvoy';
import {startConvoy,moveConvoy,ConvoyMoveError} from './games/lastConvoy';
import {VELVET_GAME} from '../src/shared/velvetReign';
import {CARAMEL_GAME,CARAMEL_MAX_WIN,validCaramelSettings,validCaramelStake,validCaramelSettlement,caramelCost,type CaramelSettings,type CaramelResult} from '../src/shared/caramelCarnival';
import {startCaramel,moveCaramel,CaramelMoveError} from './games/caramelCarnival';
import {isLuelonSlotGame,validLuelonSlotSettings,validLuelonSlotSettlement,luelonSlotMax,luelonSlotInitialCost,type LuelonSlotSettings,type LuelonSlotResult} from '../src/shared/luelonSlots';
import {startLuelonSlotGame,moveLuelonSlotGame,LuelonSlotMoveError} from './games/luelonSlots';
import {validCosmicStake} from '../src/shared/cosmicEscapeBets';
import {COSMIC_MATH_PROFILE_VERSION,type CosmicMathProfileVersion} from '../src/shared/luelonSlotsModels';
import { randomInt } from 'node:crypto';
import { isRetiredCardGame } from '../src/shared/cardTables';
import { isRetiredArcadeGame } from '../src/shared/arcadeCatalog';
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
import { STUDIO_MAX, isStudioGame, isStudioPresentationGame, isStudioJourneyPresentationGame, studioJourneyPresentationDetails, isStudioWaysPresentationGame, studioWaysPresentationDetails, isStudioCollectPresentationGame,isStudioHoldPresentationGame,isStudioWheelTrailPresentationGame,studioWheelTrailPresentationDetails,studioHoldPresentationDetails, studioCollectPresentationDetails, validStudioSettlement, validStudioSlotPresentation, type StudioSettings, type StudioSlotPresentation } from '../src/shared/studioGames';
import { startStudioGame, moveStudioGame, currentStudioSlotPresentation, StudioMoveError, type StudioResult } from './games/studioGames';

export type ExpansionState = ExpansionSession & {createdAt:number;engine?:unknown;settings:Extract<ExpansionAction,{action:'start'}>['settings'];crashPoint?:number;mathProfileVersion?:CosmicMathProfileVersion};
const CARDS:Partial<Record<ExpansionGameId,string>> = {'github-three-card':'three-card','github-caribbean':'caribbean','github-let-it-ride':'let-it-ride','github-ultimate':'ultimate','github-war':'war','github-red-dog':'red-dog','github-pai-gow':'pai-gow','github-dragon-tiger':'dragon-tiger','github-deuces':'deuces','github-mississippi':'mississippi','github-four-card':'four-card','github-crazy-four':'crazy-four','github-flush':'flush','github-holdem-bonus':'holdem-bonus','github-oasis':'oasis','github-russian':'russian','github-caribbean-draw':'caribbean-draw','github-spanish':'spanish','github-exposure':'exposure','github-switch':'switch','github-free-bet':'free-bet','github-rummy':'rummy','github-andar-bahar':'andar-bahar'};
export const EXPANSION_MAX:Record<ExpansionGameId,number> = {...STUDIO_MAX,...VARIANT_MAX,[PENALTY_GAME]:PENALTY_MAX,'github-diamonds':30,'github-crash':100,'github-three-card':55,'github-caribbean':205,'github-let-it-ride':3003,'github-ultimate':570,'github-war':3,'github-red-dog':24,'github-pai-gow':2,'github-dragon-tiger':2,'github-deuces':800,'github-sic-bo':2,'github-mississippi':5010,'github-four-card':40,'github-crazy-four':300,'github-flush':10,'github-holdem-bonus':1010,'github-oasis':205,'github-russian':205,'github-caribbean-draw':105,'github-spanish':64,'github-exposure':64,'github-switch':10,'github-free-bet':16,'github-rummy':20,'github-andar-bahar':2};
export const expansionMax = (game:ExpansionGameId,version:1|2) => game===DRACONA_GAME?DRACONA_MAX_WIN:game===AFTER_GAME?AFTER_MAX_WIN:isNitroFamily(game)?NITRO_MAX_WIN:game===CONVOY_GAME?CONVOY_MAX_WIN:version===2&&game===CARAMEL_GAME?CARAMEL_MAX_WIN:version===2&&isLuelonSlotGame(game)?luelonSlotMax(game):version===2&&game==='github-holdem-bonus'?10:version===2&&game==='github-rummy'?13:EXPANSION_MAX[game];
export function expansionInitialCost(game:ExpansionGameId,side=false){return ['github-crazy-four','github-switch'].includes(game)?2:game==='github-let-it-ride'?3:game==='github-ultimate'?2+Number(side):game==='github-three-card'?1+Number(side):1;}
const emptyView=():ExpansionView=>({player:[],dealer:[],community:[],actions:[],phase:1,ended:false,message:''});
const placeholders=EXPANSION_GAMES.map(()=>'?').join(',');
export class DemoExpansionStore {
  readonly ready:Promise<void>;
  readonly wardrobe:AfterglowWardrobeStore;
  constructor(private db:PostgresDatabase,private snapshot:(id:string)=>Promise<DemoWallet>,prerequisite:Promise<void>,private settleOther:(id:string)=>Promise<void>,
    private draw:(max:number)=>number=randomInt,private now:()=>number=Date.now,private cards=cardEngine,private crashRoll=rollCrashPoint,private cashoutDelay=new LastExitCashoutDelay()){const albumReady=prerequisite.then(()=>this.db.exec(`CREATE TABLE IF NOT EXISTS demo_afterglow_albums(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,cards INTEGER NOT NULL CHECK(cards>=0 AND cards<=45))`));this.wardrobe=new AfterglowWardrobeStore(db,albumReady);this.ready=this.wardrobe.ready;}
  private async album(account:string){const row=await this.db.prepare('SELECT cards FROM demo_afterglow_albums WHERE account_id=?').get(account);const cards=Number(row?.cards??0);if(!Number.isSafeInteger(cards)||cards<0||cards>45)throw Error('Invalid saved Afterglow album');return cards;}
  async convoyProgress(account:string):Promise<ConvoyProgress>{
    await this.ready;
    // One paid start creates one session. All bonus spins share that session.
    const row=await this.db.prepare("SELECT COUNT(*) AS rounds FROM demo_casino_sessions WHERE account_id=? AND game_id=? AND state='settled'").get(account,CONVOY_GAME);
    const progress={version:1,completedRounds:Number(row?.rounds??0)};
    if(!validConvoyProgress(progress))throw new Error('Invalid saved Convoy progress');
    return progress;
  }
  private units(s:ExpansionState,chips:number,scale=1000){const units=Number(BigInt(s.stakeUnits)*BigInt(chips)/BigInt(scale));if(!Number.isSafeInteger(units)||units<0)throw Error('Invalid expansion amount');return units;}
  private public(s:ExpansionState):ExpansionSession {
    const {engine:_,settings:__,createdAt:___,crashPoint:____,mathProfileVersion:_____,...result}=structuredClone(s);
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
    if(s.gameId===PENALTY_GAME&&!validPenaltySettlement(s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.penalty))throw Error('Invalid penalty settlement');
    if(s.gameId===DRACONA_GAME){if(s.rulesVersion!==2||!validDraconaSettlement(s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.dracona))throw Error('Invalid Dracona settlement');}
    else if(s.gameId===AFTER_GAME){
      const v=s.view.afterglow;if(s.rulesVersion!==2||!validAfterSettlement(s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,v))throw Error('Invalid Afterglow settlement');
      const prior=Math.min(45,v.albumStart+v.history.slice(0,-1).reduce((sum,spin)=>sum+spin.cards,0));if(await this.album(account)!==prior)throw Error('Afterglow album revision changed');
      await this.db.prepare('INSERT INTO demo_afterglow_albums(account_id,cards) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET cards=EXCLUDED.cards').run(account,v.albumTotal);
    }
    else if(isNitroFamily(s.gameId)){if(s.rulesVersion!==2||!validNitroSettlement(s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.nitro))throw Error('Invalid Nitro settlement');}
    else if(s.gameId===CONVOY_GAME){if(s.rulesVersion!==2||!validConvoySettlement(s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.convoy))throw Error('Invalid Convoy settlement');}
    else if(s.rulesVersion===2&&s.gameId===CARAMEL_GAME){if(!validCaramelSettlement(s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.caramel))throw Error('Invalid Caramel settlement');}
    else if(s.rulesVersion===2&&isLuelonSlotGame(s.gameId)){if(!validLuelonSlotSettlement(s.gameId,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.luelon))throw Error('Invalid Cosmic settlement');}
    else if(isStudioGame(s.gameId)&&!validStudioSettlement(s.gameId,s.state,s.stakeUnits,s.spentUnits,s.returnedUnits,s.view.studio))throw Error('Invalid studio settlement');
    if(s.gameId===AFTER_GAME&&s.state==='settled')await this.wardrobe.completeRound(account,s.id,s.stakeUnits);
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
  private async sessions(account:string,caramelClient=true,velvetClient=true,convoyClient=true,nitroClient=true,afterClient=true,memeClient=true,penaltyClient=true,draconaClient=true){
    const rows=await this.db.prepare(`SELECT DISTINCT ON(game_id) payload FROM demo_casino_sessions WHERE account_id=? AND game_id IN (${placeholders}) ORDER BY game_id,(payload::jsonb->>'createdAt')::bigint DESC,id DESC`).all(account,...EXPANSION_GAMES);
    return rows.map(row=>this.public(JSON.parse(row.payload))).filter(s=>caramelClient||s.gameId!==CARAMEL_GAME||s.rulesVersion!==2).filter(s=>velvetClient||s.gameId!==VELVET_GAME||s.rulesVersion!==2).filter(s=>convoyClient||s.gameId!==CONVOY_GAME).filter(s=>nitroClient||s.gameId!==NITRO_GAME).filter(s=>afterClient||s.gameId!==AFTER_GAME).filter(s=>memeClient||s.gameId!==MEME_GAME).filter(s=>penaltyClient||s.gameId!==PENALTY_GAME).filter(s=>draconaClient||s.gameId!==DRACONA_GAME);
  }
  async active(account:string,caramelClient=true,velvetClient=true,convoyClient=true,nitroClient=true,afterClient=true,memeClient=true,penaltyClient=true,draconaClient=true){await this.ready;return this.db.transaction(async()=>{await this.settleOther(account);await this.crashDue(account,this.now());return {wallet:await this.snapshot(account),sessions:await this.sessions(account,caramelClient,velvetClient,convoyClient,nitroClient,afterClient,memeClient,penaltyClient,draconaClient)};},{lockKey:'account:'+account});}
  async presentation(account:string,sessionId:unknown,phase:unknown,step:unknown):Promise<StudioSlotPresentation> {
    await this.ready;
    if(typeof sessionId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sessionId)||!Number.isSafeInteger(phase)||Number(phase)<1||Number(phase)>3||!Number.isSafeInteger(step)||Number(step)<0||Number(step)>2)throw new WalletError(400,'Некорректный запрос показа игры.');
    const row=await this.db.prepare("SELECT payload FROM (SELECT DISTINCT ON(game_id) id,payload FROM demo_casino_sessions WHERE account_id=? AND game_id IN ('studio-cosmic-escape','studio-velvet-reign','studio-caramel-carnival','studio-starfall-oracle','studio-lumen-grove','studio-prism-atelier','studio-stormforge-duel','studio-saffron-cipher','studio-beacon-bay','studio-copperline-express','studio-pulse-district','studio-jade-koi','studio-sky-lanterns','studio-rivet-rally','studio-frostline-courier','studio-deep-current','studio-blazing-orchard','studio-ember-vault','studio-midnight-market','studio-moonlit-mint','studio-petal-parlor','studio-sunbird-trails') ORDER BY game_id,(payload::jsonb->>'createdAt')::bigint DESC,id DESC) latest WHERE id=?").get(account,sessionId);
    if(!row)throw new WalletError(404,'Текущая партия не найдена.');
    const session=JSON.parse(row.payload) as ExpansionState,view=session.view.studio;
    if(!isStudioPresentationGame(session.gameId)||!view||view.kind!=='slot')throw new WalletError(404,'Показ этой игры недоступен.');
    if(session.view.phase!==phase||view.step!==step)throw new WalletError(409,'Этап игры изменился. Покажи сохранённый результат.');
    const current=currentStudioSlotPresentation(session.gameId,session.engine);
    if((isStudioJourneyPresentationGame(session.gameId)||isStudioWaysPresentationGame(session.gameId)||isStudioCollectPresentationGame(session.gameId)||isStudioHoldPresentationGame(session.gameId)||isStudioWheelTrailPresentationGame(session.gameId))&&(current.step!==view.step||current.stage!==view.stage||JSON.stringify(current.afterGrid)!==JSON.stringify(view.grid)
      ||JSON.stringify(current.heldAfter)!==JSON.stringify(view.held)||JSON.stringify(current.heldBefore)!==JSON.stringify(view.step?view.history[view.step-1].held:[])))throw Error('Invalid saved studio presentation');
    const details=isStudioWheelTrailPresentationGame(session.gameId)?studioWheelTrailPresentationDetails(session.gameId,view.history[view.step],view.step):isStudioHoldPresentationGame(session.gameId)?studioHoldPresentationDetails(session.gameId,current.beforeGrid,view.step?view.history[view.step-1]:null,view.history[view.step],view.step):isStudioJourneyPresentationGame(session.gameId)?studioJourneyPresentationDetails(session.gameId,current.beforeGrid,view.step?view.history[view.step-1]:null,view.history[view.step],view.step):isStudioWaysPresentationGame(session.gameId)?studioWaysPresentationDetails(session.gameId,session.gameId==='studio-rivet-rally'?current.afterGrid:current.beforeGrid,view.history[view.step],view.step):isStudioCollectPresentationGame(session.gameId)?studioCollectPresentationDetails(session.gameId,current.beforeGrid,view.history[view.step],view.step):current;
    const presentation:StudioSlotPresentation={version:1,sessionId:session.id,phase:session.view.phase,...details};
    if(!validStudioSettlement(session.gameId,session.state,session.stakeUnits,session.spentUnits,session.returnedUnits,view)||!validStudioSlotPresentation(presentation,session.gameId,session.id,session.view.phase,view))throw Error('Invalid saved studio presentation');
    return presentation;
  }
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
  private applyPenalty(s:ExpansionState,v:PenaltyView){
    s.state=v.status==='playing'?'active':'settled';
    s.view={...emptyView(),penalty:v,phase:v.revision+1,ended:s.state==='settled',message:v.status==='lost'?'Удар не достиг цели.':v.status==='playing'?'Гол! Продолжить или забрать?':'Выплата подтверждена.',actions:s.state==='active'?[{move:'penalty-kick',label:'Следующий удар',cost:0},{move:'cashout',label:'Забрать',cost:0}]:[]};
    return {debit:0,credit:v.status==='banked'||v.status==='complete'?Number(v.availableUnits):0};
  }
  private applyAfter(s:ExpansionState,result:AfterResult){
    s.engine=undefined;s.state=result.ended?'settled':'active';s.view={...emptyView(),afterglow:result.view,ended:result.ended,message:result.message,phase:result.view.revision+1,actions:result.actions};return {debit:0,credit:result.credit};
  }
  private applyNitro(s:ExpansionState,result:NitroResult){
    if(s.gameId===MEME_GAME)result={...result,message:result.ended?'MEME OVERLOAD: раунд завершён. Выплата в тестовом кошельке.':'Вирусный режим сохранён. Продолжение бесплатно.',actions:result.actions.map(a=>({...a,label:'Продолжить вирусный режим'}))};
    s.engine=undefined;s.state=result.ended?'settled':'active';s.view={...emptyView(),nitro:result.view,ended:result.ended,message:result.message,phase:result.view.revision+1,actions:result.actions};return {debit:0,credit:result.credit};
  }
  private applyDracona(s:ExpansionState,result:DraconaResult){
    s.engine=undefined;s.state=result.ended?'settled':'active';s.view={...emptyView(),dracona:result.view,ended:result.ended,message:result.message,phase:result.view.revision+1,actions:result.actions};return {debit:0,credit:result.credit};
  }
  private applyConvoy(s:ExpansionState,result:ConvoyResult){
    s.engine=undefined;s.state=result.ended?'settled':'active';s.view={...emptyView(),convoy:result.view,ended:result.ended,message:result.message,phase:result.view.revision+1,actions:result.actions};return {debit:0,credit:result.credit};
  }
  private applyCaramel(s:ExpansionState,result:CaramelResult){
    s.engine=undefined;s.state=result.ended?'settled':'active';s.view={...emptyView(),caramel:result.view,ended:result.ended,message:result.message,phase:result.view.revision+1,actions:result.actions};return {debit:0,credit:result.credit};
  }
  private applyLuelon(s:ExpansionState,result:LuelonSlotResult){
    s.engine=undefined;s.state=result.ended?'settled':'active';s.view={...emptyView(),luelon:result.luelon,ended:result.ended,message:result.message,phase:result.luelon.revision+1,actions:result.actions};return {debit:0,credit:result.credit};
  }
  async operate(account:string,value:unknown,clientRules:1|2=2,caramelClient=true,velvetClient=true,convoyClient=true,nitroClient=true,afterClient=true,afterProgressClient=true,memeClient=true,penaltyClient=true,draconaClient=true){
    await this.ready;if(!validExpansionAction(value))throw new WalletError(400,'Некорректное действие казино.');
    const op=structuredClone(value),key=JSON.stringify(op);
    if(op.gameId===PENALTY_GAME&&!penaltyClient)throw new WalletError(409,'Обнови страницу для игры CR vs. Leo. Ставка не списана.');
    if(op.gameId===DRACONA_GAME&&!draconaClient)throw new WalletError(409,'Обнови страницу для игры Дракона.');
    if(op.gameId===AFTER_GAME&&!afterClient)throw new WalletError(409,'Обнови страницу для игры GIRLHUB.');
    if(op.gameId===MEME_GAME&&!memeClient)throw new WalletError(409,'Обнови страницу для MEME OVERLOAD.');
    if(isNitroFamily(op.gameId)&&!nitroClient)throw new WalletError(409,'Обнови страницу для игры «Нитро-заезд».');
    if(op.gameId===CONVOY_GAME&&!convoyClient)throw new WalletError(409,'Обнови страницу для игры «Последний конвой».');
    if(!velvetClient&&op.gameId===VELVET_GAME&&(op.action==='start'?validLuelonSlotSettings(VELVET_GAME,op.settings):op.move==='luelon-spin'))throw new WalletError(409,'Обнови страницу для новой версии Velvet Reign. Ставка не списана.');
    if(!caramelClient&&op.gameId===CARAMEL_GAME&&(op.action==='start'?validCaramelSettings(op.settings):op.move==='caramel-spin'))throw new WalletError(409,'Обнови страницу для новой версии Caramel Carnival. Ставка не списана повторно.');
    if(op.action==='start'&&!(op.gameId===DRACONA_GAME?validDraconaStake(op.stakeUnits):op.gameId===AFTER_GAME?validAfterStake(op.stakeUnits):isNitroFamily(op.gameId)?validNitroStake(op.stakeUnits):op.gameId===CONVOY_GAME?validConvoyStake(op.stakeUnits):isLuelonSlotGame(op.gameId)?validCosmicStake(op.stakeUnits):op.gameId===CARAMEL_GAME&&validCaramelSettings(op.settings)?validCaramelStake(op.stakeUnits):(DEMO_BETS as readonly number[]).some(n=>String(n*100)===op.stakeUnits)))throw new WalletError(400,'Недопустимая ставка.');
    await this.cashoutDelay.wait(account,op);
    return this.db.transaction(async()=>{
      if(op.action==='start'&&isRetiredCardGame(op.gameId)&&!await this.db.prepare('SELECT 1 FROM demo_casino_requests WHERE account_id=? AND id=?').get(account,op.id))throw new WalletError(409,'Эта карточная игра удалена из каталога.');
      await this.settleOther(account);const at=this.now();await this.crashDue(account,at);
      const old=await this.db.prepare('SELECT * FROM demo_casino_requests WHERE account_id=? AND id=?').get(account,op.id);
      if(old){if(old.request_key!==key)throw new WalletError(409,'Нельзя изменить отправленный ход.');const row=await this.db.prepare('SELECT payload FROM demo_casino_sessions WHERE account_id=? AND id=?').get(account,old.session_id);return {wallet:await this.snapshot(account),session:this.public(JSON.parse(row!.payload)),sessions:await this.sessions(account,caramelClient,velvetClient,convoyClient,nitroClient,afterClient,memeClient,penaltyClient,draconaClient),replayed:true};}
      if(op.gameId===AFTER_GAME&&op.action==='start'&&!afterProgressClient)throw new WalletError(409,'Обнови страницу: прогресс GIRLHUB теперь зависит от суммы ставки. Ставка не списана.');
      if(op.action==='start'&&isRetiredArcadeGame(op.gameId))throw new WalletError(409,'Эта игра убрана из зала. Сохранённую партию можно завершить. Новая ставка не принята.');
      for(const table of ['demo_operations','demo_mines_requests','demo_flight_requests']){if(await this.db.prepare(`SELECT 1 FROM ${table} WHERE account_id=? AND ${table==='demo_operations'?'operation_id':'id'}=?`).get(account,op.id))throw new WalletError(409,'Этот номер операции уже использован.');}
      const recent=await this.db.prepare('SELECT count(*) AS n FROM (SELECT 1 FROM demo_casino_requests WHERE account_id=? AND created_at>? LIMIT 120) recent').get(account,this.now()-60000);
      if(Number(recent!.n)>=120)throw new WalletError(429,'Слишком много ходов. Подожди минуту.');
      let s:ExpansionState,debit=0,credit=0;
      if(op.action==='start'){
        if(op.gameId===CARAMEL_GAME&&(!caramelClient||!validCaramelSettings(op.settings)))throw new WalletError(409,'Обнови страницу: доступна новая версия Caramel Carnival. Ставка не списана.');
        if(isLuelonSlotGame(op.gameId)&&!validLuelonSlotSettings(op.gameId,op.settings))throw new WalletError(409,'Обнови страницу: доступна новая версия слота. Ставка не списана.');
        if(expansionRulesVersion(op.gameId)===2&&clientRules!==2)throw new WalletError(409,'Обнови страницу: правила этой игры исправлены. Ставка не списана.');
        if(await this.db.prepare("SELECT 1 FROM demo_casino_sessions WHERE account_id=? AND game_id=? AND state='active'").get(account,op.gameId))throw new WalletError(409,'Сначала заверши текущую партию.');
        if(op.gameId===AFTER_GAME)await this.wardrobe.assertSelection(account,op.appearance);
        const stake=Number(op.stakeUnits),balance=await demoBalanceUnits(this.db,account),cost=stake*(op.gameId===CARAMEL_GAME&&validCaramelSettings(op.settings)?caramelCost(op.settings):isLuelonSlotGame(op.gameId)&&validLuelonSlotSettings(op.gameId,op.settings)?luelonSlotInitialCost(op.gameId,op.settings):expansionInitialCost(op.gameId,('side' in op.settings?op.settings.side:false)));
        if(balance<cost)throw new WalletError(409,'Недостаточно демомонет для начальных ставок.');
        if(balance-cost+stake*expansionMax(op.gameId,expansionRulesVersion(op.gameId))+await demoReservedUnits(this.db,account)>MAX_DEMO_UNITS)throw new WalletError(409,'Уменьши ставку: возможный выигрыш превышает лимит баланса.');
        // Keep committed round order when the clock repeats or moves backwards.
        const last=await this.db.prepare("SELECT MAX((payload::jsonb->>'createdAt')::bigint) AS created_at FROM demo_casino_sessions WHERE account_id=? AND game_id=?").get(account,op.gameId);
        const createdAt=Math.max(this.now(),Number(last!.created_at??-1)+1);
        if(!Number.isSafeInteger(createdAt)||createdAt<0)throw Error('Invalid casino session order');
        s={id:op.id,gameId:op.gameId,rulesVersion:expansionRulesVersion(op.gameId),state:'active',stakeUnits:op.stakeUnits,spentUnits:'0',returnedUnits:'0',createdAt,settings:op.settings,view:emptyView(),...(op.gameId==='studio-cosmic-escape'?{mathProfileVersion:COSMIC_MATH_PROFILE_VERSION}:{})};debit=cost;
        if(op.gameId===PENALTY_GAME){credit=this.applyPenalty(s,startPenalty(op.settings as PenaltySettings,op.stakeUnits,this.draw)).credit;}
        else if(op.gameId===DRACONA_GAME){credit=this.applyDracona(s,startDracona(op.settings as DraconaSettings,op.stakeUnits,this.draw)).credit;}
        else if(op.gameId===AFTER_GAME){credit=this.applyAfter(s,startAfter(op.settings as AfterSettings,op.stakeUnits,await this.album(account),this.draw)).credit;}
        else if(isNitroFamily(op.gameId)){credit=this.applyNitro(s,startNitro(op.settings as NitroSettings,op.stakeUnits,this.draw)).credit;}
        else if(op.gameId===CONVOY_GAME){credit=this.applyConvoy(s,startConvoy(op.settings as ConvoySettings,op.stakeUnits,this.draw)).credit;}
        else if(op.gameId===CARAMEL_GAME){credit=this.applyCaramel(s,startCaramel(op.settings as CaramelSettings,op.stakeUnits,this.draw)).credit;}
        else if(isLuelonSlotGame(op.gameId)){
          credit=this.applyLuelon(s,startLuelonSlotGame(op.gameId,op.settings as LuelonSlotSettings,op.stakeUnits,this.draw,s.mathProfileVersion)).credit;
        }else if(isStudioGame(op.gameId)){
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
            return {wallet:await this.snapshot(account),session:this.public(s),sessions:await this.sessions(account,caramelClient,velvetClient,convoyClient,nitroClient,afterClient,memeClient,penaltyClient,draconaClient),replayed:false};
          }
          throw new WalletError(409,'Эта партия уже завершена.');
        }
        if(!s.view.actions.some(action=>action.move===op.move)&&s.gameId!=='github-crash')throw new WalletError(409,'Этот ход недоступен на текущем этапе.');
        const offered=s.view.actions.find(action=>action.move===op.move);const count=op.picks?.length??0;
        if(!isVariantGame(s.gameId)&&!isStudioGame(s.gameId)&&offered?.maxPicks!==undefined&&(count<(offered.minPicks??0)||count>offered.maxPicks||(op.picks??[]).some(i=>i>=s.view.player.length)))throw new WalletError(409,'Выбери допустимое количество карт.');
        const required=(offered?.cost??0)+(offered?.perPick??0)*count;if(await demoBalanceUnits(this.db,account)<required)throw new WalletError(409,'Недостаточно демомонет для этого хода.');
        if(s.gameId===PENALTY_GAME){
          try{({debit,credit}=this.applyPenalty(s,movePenalty(s.view.penalty,s.stakeUnits,op.move,op.revision,this.draw,op.penaltyRisk)));}
          catch(error){if(error instanceof PenaltyMoveError)throw new WalletError(409,error.message);throw error;}
        }else if(s.gameId===DRACONA_GAME){
          if(s.rulesVersion!==2||!draconaClient||op.move!=='dracona-spin')throw new WalletError(409,'Обнови страницу для продолжения бонуса Драконы.');
          try{({debit,credit}=this.applyDracona(s,moveDracona(s.view.dracona!,s.stakeUnits,op.revision,this.draw)));}
          catch(error){if(error instanceof DraconaMoveError)throw new WalletError(409,error.message);throw error;}
          if(debit!==required)throw Error('Dracona debit differs from offered action');
        }else if(s.gameId===AFTER_GAME){
          if(s.rulesVersion!==2||!afterClient||op.move!=='afterglow-spin')throw new WalletError(409,'Обнови страницу для продолжения фотосессии.');
          try{({debit,credit}=this.applyAfter(s,moveAfter(s.view.afterglow!,s.stakeUnits,op.revision,this.draw)));}
          catch(error){if(error instanceof AfterMoveError)throw new WalletError(409,error.message);throw error;}
          if(debit!==required)throw Error('Afterglow debit differs from offered action');
        }else         if(isNitroFamily(s.gameId)){
          if(s.rulesVersion!==2||!nitroClient||(s.gameId===MEME_GAME&&!memeClient)||op.move!=='nitro-spin')throw new WalletError(409,'Обнови страницу для продолжения гонки.');
          try{({debit,credit}=this.applyNitro(s,moveNitro(s.view.nitro!,s.stakeUnits,op.revision,this.draw)));}
          catch(error){if(error instanceof NitroMoveError)throw new WalletError(409,error.message);throw error;}
          if(debit!==required)throw Error('Nitro debit differs from offered action');
        }else if(s.gameId===CONVOY_GAME){
          if(s.rulesVersion!==2||!convoyClient||op.move!=='convoy-spin')throw new WalletError(409,'Обнови страницу для продолжения эвакуации.');
          try{({debit,credit}=this.applyConvoy(s,moveConvoy(s.view.convoy!,s.stakeUnits,op.revision,this.draw)));}
          catch(error){if(error instanceof ConvoyMoveError)throw new WalletError(409,error.message);throw error;}
          if(debit!==required)throw Error('Convoy debit differs from offered action');
        }else if(s.rulesVersion===2&&s.gameId===CARAMEL_GAME){
          if(!caramelClient||op.move!=='caramel-spin')throw new WalletError(409,'Обнови страницу для продолжения фестиваля.');
          try{({debit,credit}=this.applyCaramel(s,moveCaramel(s.view.caramel!,s.stakeUnits,op.revision,this.draw)));}
          catch(error){if(error instanceof CaramelMoveError)throw new WalletError(409,error.message);throw error;}
          if(debit!==required)throw Error('Caramel debit differs from offered action');
        }else if(s.rulesVersion===2&&isLuelonSlotGame(s.gameId)){
          if(s.mathProfileVersion!==undefined&&s.mathProfileVersion!==2&&s.mathProfileVersion!==3)throw Error('Unknown saved Cosmic probability profile');
          try{({debit,credit}=this.applyLuelon(s,moveLuelonSlotGame(s.view.luelon,s.stakeUnits,op.revision,op.move,op.picks,this.draw)));}
          catch(error){if(error instanceof LuelonSlotMoveError)throw new WalletError(409,error.message);throw error;}
          if(debit!==required)throw Error('Cosmic debit differs from offered action');
        }else if(isStudioGame(s.gameId)){
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
      if(op.gameId===AFTER_GAME&&op.action==='start')await this.wardrobe.beginRound(account,s.id);
      await this.money(account,s,op.id,debit,credit,op.action==='move'&&op.move==='pull'?'refund':'win');
      await this.db.prepare('INSERT INTO demo_casino_requests VALUES(?,?,?,?,?)').run(account,op.id,key,s.id,this.now());
      return {wallet:await this.snapshot(account),session:this.public(s),sessions:await this.sessions(account,caramelClient,velvetClient,convoyClient,nitroClient,afterClient,memeClient,penaltyClient,draconaClient),replayed:false};
    },{lockKey:'account:'+account});
  }
}
