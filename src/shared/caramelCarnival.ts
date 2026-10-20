import { t as translateText } from '../i18n/index';
export const CARAMEL_CLIENT_HEADER = 'X-Royal-Caramel-Rules';
export const CARAMEL_GAME = 'studio-caramel-carnival' as const;
export const CARAMEL_BETS = ['100','200','300','500','1000','2000','2500','5000','10000','20000','25000','50000','100000'] as const;
export const CARAMEL_MAX_WIN = 5000;
export const CARAMEL_MAX_CASCADES = 20;
export const CARAMEL_MAX_FREE_SPINS = 30;
export const CARAMEL_NAMES = [translateText('Черничное желе'),translateText('Золотая звезда'),translateText('Персиковый макарон'),translateText('Сахарный кристалл'),translateText('Полосатый полумесяц'),translateText('Шоколадное пралине'),translateText('Мятная конфета'),translateText('Праздничный билет'),translateText('Волчок +2'),translateText('Волчок +3'),translateText('Волчок +5'),translateText('Волчок +10')] as const;
export const CARAMEL_PAYTABLE = [[19,38,75],[23,45,94],[28,56,119],[35,69,150],[44,88,200],[56,113,263],[75,150,375]] as const;
export const CARAMEL_ENERGY = [2,3,5,10] as const;
export type CaramelSettings = {caramel:{mode:'normal'|'festival'}};
export type CaramelWin = {symbol:number;positions:number[];payHundredths:number;factor:number;payoutUnits:string;uncappedPayoutUnits:string};
export type CaramelDrop = {from:number;to:number;symbol:number};
export type CaramelRefill = {position:number;symbol:number};
export type CaramelFrame = {index:number;before:number[];after:number[];wins:CaramelWin[];energy:number;multiplierBefore:number;multiplierAfter:number;removed:number[];drops:CaramelDrop[];refills:CaramelRefill[];payoutUnits:string;uncappedPayoutUnits:string;stop:'continue'|'no-win'|'cascade-limit'|'win-cap'};
export type CaramelSpin = {index:number;kind:'base'|'free';initialGrid:number[];frames:CaramelFrame[];finalGrid:number[];multiplierBefore:number;multiplierAfter:number;tickets:number;freeAward:number;payoutUnits:string;uncappedPayoutUnits:string};
export type CaramelBonus = {awarded:number;played:number;remaining:number;multiplier:number};
export type CaramelView = {kind:'caramel-carnival';version:1;mode:'normal'|'festival';revision:number;history:CaramelSpin[];spin:CaramelSpin|null;bonus:CaramelBonus|null;totalPayoutUnits:string;capped:boolean};
export type CaramelResult = {view:CaramelView;ended:boolean;credit:number;message:string;actions:{move:'caramel-spin';label:string;cost:0}[]};
export const validCaramelStake = (v:unknown):v is string => typeof v==='string'&&(CARAMEL_BETS as readonly string[]).includes(v);
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,s:string)=>Object.keys(v).sort().join()===s.split(',').sort().join();
const int=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const units=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(v);
export const caramelSame=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const caramelGrid=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===30&&v.every(n=>int(n,0,11));
export function validCaramelSettings(v:unknown):v is CaramelSettings {return obj(v)&&keys(v,'caramel')&&obj(v.caramel)&&keys(v.caramel,'mode')&&(v.caramel.mode==='normal'||v.caramel.mode==='festival');}
export const caramelCost=(v:CaramelSettings)=>v.caramel.mode==='festival'?35:1;
export function caramelGroups(grid:readonly number[]){
  return CARAMEL_PAYTABLE.flatMap((pay,symbol)=>{const positions=grid.flatMap((v,i)=>v===symbol?[i]:[]);return positions.length<8?[]:[{symbol,positions,payHundredths:pay[positions.length>=12?2:positions.length>=10?1:0]}];});
}
export function caramelEnergy(grid:readonly number[]){return grid.reduce((sum,v)=>sum+(v>=8?CARAMEL_ENERGY[v-8]:0),0);}
export function caramelSurvivors(grid:readonly number[],removed:readonly number[]){
  const gone=new Set(removed),drops:CaramelDrop[]=[],empty:number[]=[];
  for(let col=0;col<6;col++){
    const keep=Array.from({length:5},(_,row)=>row*6+col).filter(pos=>!gone.has(pos));
    const offset=5-keep.length;
    for(let row=0;row<offset;row++)empty.push(row*6+col);
    keep.forEach((from,row)=>drops.push({from,to:(row+offset)*6+col,symbol:grid[from]}));
  }
  return {drops,empty};
}
export function caramelPayout(grid:readonly number[],before:number,stake:string,remaining:bigint){
  const groups=caramelGroups(grid),energy=groups.length?caramelEnergy(grid):0,multiplier=Math.min(50,before+energy);let paid=0n,raw=0n;
  const wins:CaramelWin[]=groups.map(group=>{const amount=BigInt(stake)*BigInt(group.payHundredths)*BigInt(multiplier)/100n,award=amount<remaining-paid?amount:remaining-paid;paid+=award;raw+=amount;return {...group,factor:multiplier,payoutUnits:String(award),uncappedPayoutUnits:String(amount)};});
  return {wins,energy,multiplier,paid,raw};
}
/** Reconstruct every payment, gravity step and bonus award without random draws. */
export function validCaramelSettlement(state:'active'|'settled',stake:string,spent:string,returned:string,value:unknown):value is CaramelView {
 try{
  if(!validCaramelStake(stake)||!obj(value)||!keys(value,'kind,version,mode,revision,history,spin,bonus,totalPayoutUnits,capped')||value.kind!=='caramel-carnival'||value.version!==1||!validCaramelSettings({caramel:{mode:value.mode}})||!Array.isArray(value.history)||value.history.length>31||value.revision!==value.history.length||!units(value.totalPayoutUnits)||typeof value.capped!=='boolean'||spent!==String(BigInt(stake)*BigInt(value.mode==='festival'?35:1)))return false;
  const cap=BigInt(stake)*BigInt(CARAMEL_MAX_WIN);let total=0n,bonus:CaramelBonus|null=value.mode==='festival'?{awarded:10,played:0,remaining:10,multiplier:1}:null;
  for(let index=0;index<value.history.length;index++){
   const spin=value.history[index];if(total===cap||!obj(spin)||!keys(spin,'index,kind,initialGrid,frames,finalGrid,multiplierBefore,multiplierAfter,tickets,freeAward,payoutUnits,uncappedPayoutUnits')||spin.index!==index||spin.kind!==(bonus?'free':'base')||!bonus&&index!==0||bonus&&!bonus.remaining||!caramelGrid(spin.initialGrid)||!caramelGrid(spin.finalGrid)||!Array.isArray(spin.frames)||!spin.frames.length||spin.frames.length>21||!units(spin.payoutUnits)||!units(spin.uncappedPayoutUnits))return false;
   let multiplier=bonus?.multiplier??1,paid=0n,raw=0n,grid=spin.initialGrid; if(spin.multiplierBefore!==multiplier)return false;
   for(let step=0;step<spin.frames.length;step++){
    const frame=spin.frames[step];if(!obj(frame)||!keys(frame,'index,before,after,wins,energy,multiplierBefore,multiplierAfter,removed,drops,refills,payoutUnits,uncappedPayoutUnits,stop')||frame.index!==step||!caramelGrid(frame.before)||!caramelGrid(frame.after)||!caramelSame(frame.before,grid)||!Array.isArray(frame.wins)||frame.wins.length>3||!Array.isArray(frame.removed)||!Array.isArray(frame.drops)||!Array.isArray(frame.refills)||!units(frame.payoutUnits)||!units(frame.uncappedPayoutUnits))return false;
    const expected=caramelPayout(grid,multiplier,stake,cap-total-paid),last=step===spin.frames.length-1;
    if(!caramelSame(frame.wins,expected.wins)||frame.energy!==expected.energy||frame.multiplierBefore!==multiplier||frame.multiplierAfter!==expected.multiplier||frame.payoutUnits!==String(expected.paid)||frame.uncappedPayoutUnits!==String(expected.raw))return false;
    paid+=expected.paid;raw+=expected.raw;multiplier=expected.multiplier;
    const capped=total+paid===cap,stop=capped?'win-cap':!expected.wins.length?'no-win':step===19?'cascade-limit':'continue';
    if(frame.stop!==stop||last!==(stop!=='continue')||step>19)return false;
    if(capped||!expected.wins.length){if(frame.removed.length||frame.drops.length||frame.refills.length||!caramelSame(frame.after,grid))return false;}
    else{
     const removed=[...new Set([...expected.wins.flatMap(w=>w.positions),...grid.flatMap((v,i)=>v>=8?[i]:[])])].sort((a,b)=>a-b),gravity=caramelSurvivors(grid,removed),after=Array<number>(30).fill(-1);
     if(!caramelSame(frame.removed,removed)||!caramelSame(frame.drops,gravity.drops)||frame.refills.length!==gravity.empty.length)return false;
     for(const drop of gravity.drops)after[drop.to]=drop.symbol;
     for(let i=0;i<gravity.empty.length;i++){const refill=frame.refills[i];if(!obj(refill)||!keys(refill,'position,symbol')||refill.position!==gravity.empty[i]||!int(refill.symbol,0,11))return false;after[refill.position]=refill.symbol;}
     if(!caramelSame(after,frame.after))return false;
    }
    grid=frame.after;
   }
   total+=paid;const tickets=grid.filter(v=>v===7).length,capped=total===cap;let award=0;
   if(bonus){bonus.played++;bonus.remaining--;bonus.multiplier=multiplier;if(!capped&&tickets>=3){award=Math.min(3,30-bonus.awarded);bonus.awarded+=award;bonus.remaining+=award;}if(capped)bonus.remaining=0;}
   else if(!capped&&tickets>=4){award=10;bonus={awarded:10,played:0,remaining:10,multiplier:1};}
   if(!caramelSame(grid,spin.finalGrid)||spin.multiplierAfter!==multiplier||spin.tickets!==tickets||spin.freeAward!==award||spin.payoutUnits!==String(paid)||spin.uncappedPayoutUnits!==String(raw))return false;
  }
  if(value.mode==='normal'&&!value.history.length||!caramelSame(value.spin,value.history.at(-1)??null)||!caramelSame(value.bonus,bonus)||value.totalPayoutUnits!==String(total)||value.capped!==(total===cap)||returned!==(state==='settled'?String(total):'0'))return false;
  return (state==='active')===!!(bonus?.remaining&&total<cap);
 }catch{return false;}
}
export function validCaramelEnvelope(state:'active'|'settled',v:unknown):boolean{
 if(!obj(v)||!keys(v,'caramel,player,dealer,community,actions,phase,ended,message')||!obj(v.caramel)||v.phase!==Number(v.caramel.revision)+1||v.ended!==(state==='settled')||typeof v.message!=='string'||![v.player,v.dealer,v.community].every(a=>Array.isArray(a)&&a.length===0)||!Array.isArray(v.actions))return false;
 if(state==='settled')return !v.actions.length;
 const a=v.actions[0];return v.actions.length===1&&obj(a)&&keys(a,'move,label,cost')&&a.move==='caramel-spin'&&a.cost===0&&typeof a.label==='string';
}
