import {recoverableStakes} from './gameStakes';
import { t as translateText } from '../i18n/index';
import {NITRO_LINES} from './nitroRun';
export const AFTER_GAME='studio-afterglow' as const,AFTER_CLIENT_HEADER='X-Royal-Afterglow-Rules';
export const AFTER_BETS = recoverableStakes(['100','200','300','500','1000','2000','2500','5000','10000','20000','25000','50000','100000']);
export const AFTER_MAX_WIN=5000,AFTER_MAX_FREE=20,AFTER_MAX_FRAMES=10,AFTER_MAX_PINS=3;
export const AFTER_LINES=NITRO_LINES.slice(0,14);
export const AFTER_NAMES=[translateText('Вишни'),translateText('Помада'),translateText('Парфюм'),translateText('Туфелька'),translateText('Сердце'),translateText('Зеркальце'),translateText('WILD: маска'),translateText('Камера'),translateText('Вспышка')] as const;
export const AFTER_GIRLS=[{name:translateText('Алиса'),cards:0},{name:translateText('Мия'),cards:8},{name:translateText('Ева'),cards:22},{name:translateText('Наоми'),cards:45}] as const;
export const AFTER_ALBUM_MAX=45;
export const afterUnlocked=(cards:number)=>AFTER_GIRLS.filter(g=>cards>=g.cards).length;
export const AFTER_PAYTABLE=[[23,58,173,578],[29,87,260,867],[40,130,405,1300],[58,202,665,2023],[87,347,1156,3468],[130,520,2023,6358],[289,867,3468,11560]] as const;
export const AFTER_RULES=translateText('Поле 6×5, 14 постоянных линий. От трёх одинаковых символов слева. WILD заменяет обычные символы, на каждой линии оплачивается лучшая комбинация с учётом множителя ячеек. Выигрышные символы падают каскадом. Вспышка на выигрышном поле заряжает свою ячейку для следующих каскадов до ×4. Линия получает наибольший множитель среди своих выигрышных ячеек. 3/4/5+ камер на конечном поле дают 8/10/12 бесплатных вращений. В фотосессии закрепляются до трёх WILD, множители ячеек сохраняются. Линия из закреплённых WILD оплачивается один раз за спин. Три камеры внутри бонуса добавляют два спина, максимум 20 за раунд. До 10 показов поля за спин. Общий предел выплаты 5000 ставок. Одна ставка и одна итоговая выплата. Героини и вторые образы открываются по прогрессу от суммы принятых ставок после завершения раунда. Альбом не меняет вероятности и выплаты. Только тестовые монеты.');
export type AfterSettings={afterglow:{mode:'normal'}};
export type AfterWin={symbol:number;line:number;positions:number[];payHundredths:number;factor:number;payoutUnits:string;uncappedPayoutUnits:string};
export type AfterStop='continue'|'no-win'|'cascade-limit'|'held-line'|'win-cap';
export type AfterFrame={index:number;before:number[];after:number[];wins:AfterWin[];pinsBefore:number[];pinsAfter:number[];cellsBefore:number[];cellsAfter:number[];lockedBefore:number[];lockedAfter:number[];flashes:number[];removed:number[];drops:{from:number;to:number;symbol:number}[];refills:{position:number;symbol:number}[];payoutUnits:string;uncappedPayoutUnits:string;stop:AfterStop};
export type AfterSpin={index:number;kind:'base'|'free';initialGrid:number[];frames:AfterFrame[];finalGrid:number[];pinsBefore:number[];pinsAfter:number[];cellsBefore:number[];cellsAfter:number[];cameras:number;freeAward:number;cards:number;payoutUnits:string;uncappedPayoutUnits:string};
export type AfterBonus={awarded:number;played:number;remaining:number;pins:number[];cells:number[]};
export type AfterView={kind:'afterglow';version:1;mode:'normal';revision:number;history:AfterSpin[];spin:AfterSpin;bonus:AfterBonus|null;albumStart:number;albumTotal:number;totalPayoutUnits:string;capped:boolean};
export type AfterResult={view:AfterView;ended:boolean;credit:number;message:string;actions:{move:'afterglow-spin';label:string;cost:0}[]};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,s:string)=>Object.keys(v).sort().join()===s.split(',').sort().join();
const int=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const units=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(v);
export const afterSame=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const afterGrid=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===30&&Array.from(v).every(n=>int(n,0,8));
export const validAfterStake=(v:unknown):v is string=>typeof v==='string'&&(AFTER_BETS as readonly string[]).includes(v);
export function validAfterSettings(v:unknown):v is AfterSettings{return obj(v)&&keys(v,'afterglow')&&obj(v.afterglow)&&keys(v.afterglow,'mode')&&v.afterglow.mode==='normal';}
export const afterCells=()=>Array<number>(30).fill(1);
/** Select the highest paid combination, including the actual cells touched by that combination. */
export function afterGroups(grid:readonly number[],cells:readonly number[],locked:readonly number[]=[]){
 return AFTER_LINES.flatMap((path,line)=>{if(locked.includes(line))return[];let best:Omit<AfterWin,'payoutUnits'|'uncappedPayoutUnits'>|undefined;
  for(let symbol=0;symbol<=6;symbol++){const positions:number[]=[];for(let col=0;col<6;col++){const p=path[col]*6+col;if(grid[p]===symbol||symbol!==6&&grid[p]===6)positions.push(p);else break;}if(positions.length<3)continue;
   const payHundredths=AFTER_PAYTABLE[symbol][positions.length-3],factor=Math.max(...positions.map(p=>cells[p]));if(!best||payHundredths*factor>best.payHundredths*best.factor)best={symbol,line,positions,payHundredths,factor};}
  return best?[best]:[];
 });
}
/** Anchors split each reel into independent gravity segments. */
export function afterSurvivors(grid:readonly number[],removed:readonly number[],pins:readonly number[]){
 const gone=new Set(removed),held=new Set(pins),drops:AfterFrame['drops']=[],empty:number[]=[];
 for(let col=0;col<6;col++){let segment:number[]=[];const flush=()=>{const keep=segment.filter(p=>!gone.has(p)),offset=segment.length-keep.length;empty.push(...segment.slice(0,offset));keep.forEach((from,i)=>drops.push({from,to:segment[offset+i],symbol:grid[from]}));segment=[];};for(let row=0;row<5;row++){const p=row*6+col;if(held.has(p)){flush();drops.push({from:p,to:p,symbol:grid[p]});}else segment.push(p);}flush();}
 return{drops,empty};
}
export function afterDecision(grid:readonly number[],cells:readonly number[],pins:readonly number[],locked:readonly number[],free:boolean,index:number,stake:string,remaining:bigint){
 const nextPins=free?[...pins,...grid.flatMap((s,p)=>s===6&&!pins.includes(p)?[p]:[]).slice(0,AFTER_MAX_PINS-pins.length)].sort((a,b)=>a-b):[];
 let paid=0n,raw=0n;
 const wins:AfterWin[]=afterGroups(grid,cells,locked).map(g=>{const amount=BigInt(stake)*BigInt(g.payHundredths)*BigInt(g.factor)/100n,award=amount<remaining-paid?amount:remaining-paid;paid+=award;raw+=amount;return{...g,payoutUnits:String(award),uncappedPayoutUnits:String(amount)};});
 const nextLocked=[...new Set([...locked,...wins.filter(w=>w.positions.every(p=>nextPins.includes(p))).map(w=>w.line)])].sort((a,b)=>a-b);
 const flashes=wins.length?grid.flatMap((s,p)=>s===8?[p]:[]):[],nextCells=[...cells];for(const p of flashes)nextCells[p]=Math.min(4,nextCells[p]+1);
 const remove=[...new Set([...wins.flatMap(w=>w.positions),...flashes])].filter(p=>!nextPins.includes(p)).sort((a,b)=>a-b);
 const stop:AfterStop=paid===remaining?'win-cap':!wins.length?'no-win':index===AFTER_MAX_FRAMES-1?'cascade-limit':!remove.length?'held-line':'continue';
 return{wins,paid,raw,pins:nextPins,cells:nextCells,locked:nextLocked,flashes,removed:stop==='continue'?remove:[],stop};
}
export type AfterSeed=Omit<AfterView,'spin'>&{spin:AfterSpin|null};
export function afterInitial(albumStart=0):AfterSeed{if(!int(albumStart,0,AFTER_ALBUM_MAX))throw Error('Invalid album state');return{kind:'afterglow',version:1,mode:'normal',revision:0,history:[],spin:null,bonus:null,albumStart,albumTotal:albumStart,totalPayoutUnits:'0',capped:false};}
/** Pure presentation and payout model; the caller supplies symbols from trusted entropy. */
export function afterNext(value:AfterSeed,stake:string,sample:()=>number):AfterView{
 const v={...value,history:[...value.history],bonus:value.bonus?{...value.bonus,pins:[...value.bonus.pins],cells:[...value.bonus.cells]}:null},free=!!value.bonus,pinsBefore=[...(v.bonus?.pins??[])],cellsBefore=[...(v.bonus?.cells??afterCells())];
 const symbol=()=>{const n=sample();if(!int(n,0,8))throw Error('Invalid Afterglow symbol');return n;};
 const initial=Array.from({length:30},(_,p)=>pinsBefore.includes(p)?6:symbol()),cap=BigInt(stake)*BigInt(AFTER_MAX_WIN),frames:AfterFrame[]=[];
 let grid=initial,pins=pinsBefore,cells=cellsBefore,locked:number[]=[],paid=0n,raw=0n;
 for(let index=0;index<AFTER_MAX_FRAMES;index++){
  const d=afterDecision(grid,cells,pins,locked,free,index,stake,cap-BigInt(v.totalPayoutUnits)-paid);let after=[...grid],drops:AfterFrame['drops']=[],refills:AfterFrame['refills']=[];
  if(d.stop==='continue'){const gravity=afterSurvivors(grid,d.removed,d.pins);drops=gravity.drops;refills=gravity.empty.map(position=>({position,symbol:symbol()}));after=Array<number>(30).fill(-1);for(const drop of drops)after[drop.to]=drop.symbol;for(const r of refills)after[r.position]=r.symbol;}
  frames.push({index,before:[...grid],after,wins:d.wins,pinsBefore:[...pins],pinsAfter:d.pins,cellsBefore:[...cells],cellsAfter:d.cells,lockedBefore:[...locked],lockedAfter:d.locked,flashes:d.flashes,removed:d.removed,drops,refills,payoutUnits:String(d.paid),uncappedPayoutUnits:String(d.raw),stop:d.stop});
  paid+=d.paid;raw+=d.raw;grid=after;pins=d.pins;cells=d.cells;locked=d.locked;if(d.stop!=='continue')break;
 }
 const total=BigInt(v.totalPayoutUnits)+paid,capped=total===cap,cameras=grid.filter(s=>s===7).length;let freeAward=0;
 if(v.bonus){v.bonus.played++;v.bonus.remaining--;v.bonus.pins=pins;v.bonus.cells=cells;if(!capped&&cameras>=3){freeAward=Math.min(2,AFTER_MAX_FREE-v.bonus.awarded);v.bonus.awarded+=freeAward;v.bonus.remaining+=freeAward;}if(capped)v.bonus.remaining=0;}
 else if(!capped&&cameras>=3){freeAward=cameras>=5?12:cameras===4?10:8;v.bonus={awarded:freeAward,played:0,remaining:freeAward,pins:[],cells:afterCells()};}
 const cards=cameras+Number(!free),albumTotal=Math.min(AFTER_ALBUM_MAX,v.albumTotal+cards),spin:AfterSpin={index:v.history.length,kind:free?'free':'base',initialGrid:initial,frames,finalGrid:grid,pinsBefore,pinsAfter:pins,cellsBefore,cellsAfter:cells,cameras,freeAward,cards,payoutUnits:String(paid),uncappedPayoutUnits:String(raw)};
 v.history.push(spin);return{...v,spin,revision:v.history.length,albumTotal,totalPayoutUnits:String(total),capped};
}
/** Rebuild every field, anchor, cell multiplier, bonus and album increment without generating entropy. */
export function validAfterSettlement(state:'active'|'settled',stake:string,spent:string,returned:string,value:unknown):value is AfterView{
 try{
  if(!validAfterStake(stake)||spent!==stake||!obj(value)||!keys(value,'kind,version,mode,revision,history,spin,bonus,albumStart,albumTotal,totalPayoutUnits,capped')||value.kind!=='afterglow'||value.version!==1||value.mode!=='normal'||!int(value.albumStart,0,45)||!int(value.albumTotal,0,45)||!Array.isArray(value.history)||!int(value.history.length,1,21)||value.revision!==value.history.length||!units(value.totalPayoutUnits)||typeof value.capped!=='boolean')return false;
  let expected:AfterSeed=afterInitial(value.albumStart);
  for(const spin of value.history){
   if(expected.capped||expected.history.length&&!expected.bonus?.remaining||!obj(spin)||!afterGrid(spin.initialGrid)||!Array.isArray(spin.frames)||!int(spin.frames.length,1,10))return false;
   const entropy:number[]=spin.initialGrid.filter((_,p)=>!expected.bonus?.pins.includes(p));
   for(const frame of spin.frames){if(!obj(frame)||!Array.isArray(frame.refills)||frame.refills.length>30)return false;for(const r of frame.refills){if(!obj(r)||!int(r.symbol,0,8))return false;entropy.push(r.symbol);}}
   let cursor=0;const next=afterNext(expected,stake,()=>entropy[cursor++]);if(cursor!==entropy.length||!afterSame(next.spin,spin))return false;expected=next;
  }
  const ended=!expected.bonus?.remaining||expected.capped;
  return afterSame(value,expected)&&ended===(state==='settled')&&returned===(ended?expected.totalPayoutUnits:'0');
 }catch{return false;}
}
export function validAfterSession(v:unknown):boolean{
 if(!obj(v)||!keys(v,'gameId,id,returnedUnits,rulesVersion,spentUnits,stakeUnits,state,view')||v.gameId!==AFTER_GAME||v.rulesVersion!==2||typeof v.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.id)||(v.state!=='active'&&v.state!=='settled')||typeof v.stakeUnits!=='string'||typeof v.spentUnits!=='string'||typeof v.returnedUnits!=='string'||!obj(v.view)||!keys(v.view,'afterglow,player,dealer,community,actions,phase,ended,message')||!validAfterSettlement(v.state,v.stakeUnits,v.spentUnits,v.returnedUnits,v.view.afterglow))return false;
 const w=v.view,view=w.afterglow as AfterView;if(![w.player,w.dealer,w.community].every(a=>Array.isArray(a)&&a.length===0)||w.phase!==view.revision+1||w.ended!==(v.state==='settled')||typeof w.message!=='string'||!Array.isArray(w.actions))return false;
 if(v.state==='settled')return w.actions.length===0;const a=w.actions[0];return w.actions.length===1&&obj(a)&&keys(a,'move,label,cost')&&a.move==='afterglow-spin'&&a.cost===0&&typeof a.label==='string';
}
