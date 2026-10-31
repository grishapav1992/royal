import {recoverableStakes} from './gameStakes';
import { t as translateText } from '../i18n/index';
export const CONVOY_GAME = 'studio-last-convoy' as const;
export const CONVOY_CLIENT_HEADER = 'X-Royal-Convoy-Rules';
export const CONVOY_BETS = recoverableStakes(['100','200','300','500','1000','2000','2500','5000','10000','20000','25000','50000','100000']);
export const CONVOY_MAX_WIN = 5000;
export const CONVOY_MAX_FREE = 20;
export const CONVOY_MAX_PINS = 6;
export const CONVOY_NAMES = [translateText('Аптечка'),translateText('Рация'),translateText('Топливо'),translateText('Фонарь'),translateText('Припасы'),translateText('Рюкзак'),translateText('Зомби'),translateText('Маяк эвакуации'),translateText('Баррикада')] as const;
export const CONVOY_PAYTABLE = [[40,81,159],[49,95,199],[59,119,252],[74,146,318],[93,187,424],[119,240,558],[159,318,795]] as const;
export type ConvoySettings = {convoy:{mode:'normal'}};
export type ConvoyWin = {symbol:number;positions:number[];payHundredths:number;factor:number;payoutUnits:string;uncappedPayoutUnits:string};
export type ConvoyDrop = {from:number;to:number;symbol:number};
export type ConvoyRefill = {position:number;symbol:number};
export type ConvoyFrame = {index:number;before:number[];after:number[];wins:ConvoyWin[];addedPins:number[];multiplierBefore:number;multiplierAfter:number;removed:number[];drops:ConvoyDrop[];refills:ConvoyRefill[];payoutUnits:string;uncappedPayoutUnits:string;stop:'continue'|'no-win'|'cascade-limit'|'win-cap'};
export type ConvoySpin = {index:number;kind:'base'|'free';initialGrid:number[];frames:ConvoyFrame[];finalGrid:number[];pinsBefore:number[];pinsAfter:number[];multiplierBefore:number;multiplierAfter:number;beacons:number;freeAward:number;payoutUnits:string;uncappedPayoutUnits:string};
export type ConvoyBonus = {awarded:number;played:number;remaining:number;pins:number[];multiplier:number};
export type ConvoyView = {kind:'last-convoy';version:1;mode:'normal';revision:number;history:ConvoySpin[];spin:ConvoySpin;bonus:ConvoyBonus|null;totalPayoutUnits:string;capped:boolean};
export type ConvoyResult = {view:ConvoyView;ended:boolean;credit:number;message:string;actions:{move:'convoy-spin';label:string;cost:0}[]};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,s:string)=>Object.keys(v).sort().join()===s.split(',').sort().join();
const int=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const units=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(v);
export const convoySame=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const convoyPins=(grid:readonly number[])=>grid.flatMap((v,i)=>v===8?[i]:[]);
export const convoyGrid=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===30&&v.every(n=>int(n,0,8))&&convoyPins(v).length<=6;
export const validConvoyStake=(v:unknown):v is string=>typeof v==='string'&&(CONVOY_BETS as readonly string[]).includes(v);
export function validConvoySettings(v:unknown):v is ConvoySettings {return obj(v)&&keys(v,'convoy')&&obj(v.convoy)&&keys(v.convoy,'mode')&&v.convoy.mode==='normal';}
export function convoyGroups(grid:readonly number[]) {
 return CONVOY_PAYTABLE.flatMap((pay,symbol)=>{const positions=grid.flatMap((v,i)=>v===symbol?[i]:[]);return positions.length<8?[]:[{symbol,positions,payHundredths:pay[positions.length>=12?2:positions.length>=10?1:0]}];});
}
/** Locked barricades keep their exact cells; other symbols fall into free cells. */
export function convoySurvivors(grid:readonly number[],removed:readonly number[]) {
 const gone=new Set(removed),drops:ConvoyDrop[]=[],empty:number[]=[];
 for(let col=0;col<6;col++) {
  const column=Array.from({length:5},(_,r)=>r*6+col),free=column.filter(p=>grid[p]!==8),keep=free.filter(p=>!gone.has(p)),offset=free.length-keep.length;
  for(const p of column)if(grid[p]===8)drops.push({from:p,to:p,symbol:8});
  empty.push(...free.slice(0,offset));keep.forEach((from,i)=>drops.push({from,to:free[offset+i],symbol:grid[from]}));
 }
 return {drops,empty};
}
export function convoyPayout(grid:readonly number[],stake:string,remaining:bigint) {
 const multiplier=1+convoyPins(grid).length;let paid=0n,raw=0n;
 const wins:ConvoyWin[]=convoyGroups(grid).map(g=>{const amount=BigInt(stake)*BigInt(g.payHundredths)*BigInt(multiplier)/100n,award=amount<remaining-paid?amount:remaining-paid;paid+=award;raw+=amount;return {...g,factor:multiplier,payoutUnits:String(award),uncappedPayoutUnits:String(amount)};});
 return {wins,multiplier,paid,raw};
}
export const convoyFreeAward=(beacons:number)=>beacons>=5?15:beacons===4?12:beacons>=3?10:0;
/** Replay all confirmed frames, pins, caps and free-spin accounting without RNG. */
export function validConvoySettlement(state:'active'|'settled',stake:string,spent:string,returned:string,value:unknown):value is ConvoyView {
 try {
  if(!validConvoyStake(stake)||spent!==stake||!obj(value)||!keys(value,'kind,version,mode,revision,history,spin,bonus,totalPayoutUnits,capped')||value.kind!=='last-convoy'||value.version!==1||value.mode!=='normal'||!Array.isArray(value.history)||!int(value.history.length,1,21)||value.revision!==value.history.length||!units(value.totalPayoutUnits)||typeof value.capped!=='boolean')return false;
  const cap=BigInt(stake)*5000n;let total=0n,bonus:ConvoyBonus|null=null;
  for(let index=0;index<value.history.length;index++) {
   const s=value.history[index],pinsBefore: number[]=bonus?.pins??[];
   if(total===cap||!obj(s)||!keys(s,'index,kind,initialGrid,frames,finalGrid,pinsBefore,pinsAfter,multiplierBefore,multiplierAfter,beacons,freeAward,payoutUnits,uncappedPayoutUnits')||s.index!==index||s.kind!==(bonus?'free':'base')||!bonus&&index!==0||bonus&&!bonus.remaining||!convoyGrid(s.initialGrid)||!convoyGrid(s.finalGrid)||!convoySame(s.pinsBefore,pinsBefore)||pinsBefore.some(p=>(s.initialGrid as number[])[p]!==8)||!Array.isArray(s.frames)||!int(s.frames.length,1,20)||!units(s.payoutUnits)||!units(s.uncappedPayoutUnits))return false;
   let grid=s.initialGrid,pins=[...pinsBefore],multiplier=1+pins.length,paid=0n,raw=0n;
   if(s.multiplierBefore!==multiplier)return false;
   for(let step=0;step<s.frames.length;step++) {
    const f=s.frames[step];
    if(!obj(f)||!keys(f,'index,before,after,wins,addedPins,multiplierBefore,multiplierAfter,removed,drops,refills,payoutUnits,uncappedPayoutUnits,stop')||f.index!==step||!convoyGrid(f.before)||!convoyGrid(f.after)||!convoySame(f.before,grid)||!Array.isArray(f.wins)||!Array.isArray(f.removed)||!Array.isArray(f.drops)||!Array.isArray(f.refills))return false;
    const nextPins=convoyPins(grid),expected=convoyPayout(grid,stake,cap-total-paid),addedPins=nextPins.filter(p=>!pins.includes(p));
    if(pins.some(p=>grid[p]!==8)||!convoySame(f.addedPins,addedPins)||!convoySame(f.wins,expected.wins)||f.multiplierBefore!==multiplier||f.multiplierAfter!==expected.multiplier||f.payoutUnits!==String(expected.paid)||f.uncappedPayoutUnits!==String(expected.raw))return false;
    pins=nextPins;multiplier=expected.multiplier;paid+=expected.paid;raw+=expected.raw;
    const stop=total+paid===cap?'win-cap':!expected.wins.length?'no-win':step===19?'cascade-limit':'continue';
    if(f.stop!==stop||(step===s.frames.length-1)!==(stop!=='continue'))return false;
    if(stop!=='continue') {if(f.removed.length||f.drops.length||f.refills.length||!convoySame(f.after,grid))return false;}
    else {
     const removed=expected.wins.flatMap(w=>w.positions).sort((a,b)=>a-b),gravity=convoySurvivors(grid,removed),after=Array<number>(30).fill(-1);
     if(!convoySame(f.removed,removed)||!convoySame(f.drops,gravity.drops)||f.refills.length!==gravity.empty.length)return false;
     for(const d of gravity.drops)after[d.to]=d.symbol;
     for(let i=0;i<gravity.empty.length;i++){const r=f.refills[i];if(!obj(r)||!keys(r,'position,symbol')||r.position!==gravity.empty[i]||!int(r.symbol,0,8))return false;after[r.position]=r.symbol;}
     if(!convoyGrid(after)||!convoySame(f.after,after))return false;
    }
    grid=f.after;
   }
   total+=paid;const beacons=grid.filter(v=>v===7).length,capped=total===cap;let award=0;
   if(bonus){bonus.played++;bonus.remaining--;bonus.pins=pins;bonus.multiplier=multiplier;if(!capped&&beacons>=3){award=Math.min(2,20-bonus.awarded);bonus.awarded+=award;bonus.remaining+=award;}if(capped)bonus.remaining=0;}
   else if(!capped&&(award=convoyFreeAward(beacons))){bonus={awarded:award,played:0,remaining:award,pins:[],multiplier:1};}
   if(!convoySame(s.finalGrid,grid)||!convoySame(s.pinsAfter,pins)||s.multiplierAfter!==multiplier||s.beacons!==beacons||s.freeAward!==award||s.payoutUnits!==String(paid)||s.uncappedPayoutUnits!==String(raw))return false;
  }
  return convoySame(value.spin,value.history.at(-1))&&convoySame(value.bonus,bonus)&&value.totalPayoutUnits===String(total)&&value.capped===(total===cap)&&returned===(state==='settled'?String(total):'0')&&(state==='active')===!!(bonus?.remaining&&total<cap);
 }catch{return false;}
}
export function validConvoyEnvelope(state:'active'|'settled',v:unknown):boolean {
 if(!obj(v)||!keys(v,'convoy,player,dealer,community,actions,phase,ended,message')||!obj(v.convoy)||v.phase!==Number(v.convoy.revision)+1||v.ended!==(state==='settled')||typeof v.message!=='string'||![v.player,v.dealer,v.community].every(a=>Array.isArray(a)&&!a.length)||!Array.isArray(v.actions))return false;
 if(state==='settled')return !v.actions.length;
 const a=v.actions[0];return v.actions.length===1&&obj(a)&&keys(a,'move,label,cost')&&a.move==='convoy-spin'&&a.cost===0&&typeof a.label==='string';
}
