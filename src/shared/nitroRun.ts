import { t as translateText } from '../i18n/index';
export const NITRO_GAME = 'studio-nitro-run' as const;
export const NITRO_CLIENT_HEADER = 'X-Royal-Nitro-Rules';
export const NITRO_BETS = ['100','200','300','500','1000','2000','2500','5000','10000','20000','25000','50000','100000'] as const;
export const NITRO_MAX_WIN = 3000, NITRO_MAX_FREE = 20, NITRO_MAX_FRAMES = 12;
export const NITRO_NAMES = [translateText('Гоночное колесо'),translateText('Шлем'),translateText('Спортивный руль'),translateText('Турбина'),translateText('Синий купе'),translateText('Оранжевый маслкар'),translateText('WILD: шестерня'),translateText('Финишные флаги'),translateText('Баллон нитро')] as const;
// Payments are hundredths of the total stake, for 3, 4, 5 or 6 symbols from the left.
export const NITRO_PAYTABLE = [[17,41,124,414],[21,62,186,621],[29,93,290,931],[41,145,476,1448],[62,248,828,2483],[93,372,1448,4551],[207,621,2483,8275]] as const;
export const NITRO_LINES:readonly (readonly number[])[] = [
 [2,2,2,2,2,2],[0,0,0,0,0,0],[1,1,1,1,1,1],[3,3,3,3,3,3],[4,4,4,4,4,4],
 [0,1,2,3,4,3],[4,3,2,1,0,1],[0,1,2,2,1,0],[4,3,2,2,3,4],[1,2,3,3,2,1],
 [3,2,1,1,2,3],[0,0,1,1,0,0],[4,4,3,3,4,4],[1,1,2,2,1,1],[3,3,2,2,3,3],
 [0,2,4,4,2,0],[4,2,0,0,2,4],[1,3,1,3,1,3],[3,1,3,1,3,1],[2,0,2,4,2,0],
];
export const NITRO_RULES = translateText('Поле 6×5, 20 постоянных линий. От трёх одинаковых символов слева; WILD заменяет обычные символы. На каждой линии платится лучшая комбинация. Выигрышные символы исчезают каскадом, передача повышается для следующего каскада до ×5. Два баллона нитро, собранные на выигрышных полях, дают один бесплатный перезапуск поля при остановке серии в этом вращении. 3/4/5+ флагов на конечном поле дают 8/10/12 бесплатных вращений со второй передачи. В бесплатной гонке 3 флага добавляют 2 вращения, максимум 20 всего. До 12 показов поля за вращение, предел всего раунда 3000 ставок. Одна ставка за все линии и одна итоговая выплата. Только тестовые монеты.');
export type NitroSettings = {nitro:{mode:'normal'}};
export type NitroWin = {symbol:number;line:number;positions:number[];payHundredths:number;factor:number;payoutUnits:string;uncappedPayoutUnits:string};
export type NitroDrop = {from:number;to:number;symbol:number};
export type NitroRefill = {position:number;symbol:number};
export type NitroStop = 'continue'|'nitro'|'no-win'|'cascade-limit'|'win-cap';
export type NitroFrame = {index:number;before:number[];after:number[];wins:NitroWin[];energy:number;nitroBefore:number;nitroAfter:number;nitroUsedBefore:boolean;nitroUsedAfter:boolean;multiplierBefore:number;multiplierAfter:number;removed:number[];drops:NitroDrop[];refills:NitroRefill[];payoutUnits:string;uncappedPayoutUnits:string;stop:NitroStop};
export type NitroSpin = {index:number;kind:'base'|'free';initialGrid:number[];frames:NitroFrame[];finalGrid:number[];multiplierBefore:number;multiplierAfter:number;flags:number;freeAward:number;payoutUnits:string;uncappedPayoutUnits:string};
export type NitroBonus = {awarded:number;played:number;remaining:number};
export type NitroView = {kind:'nitro-run';version:1;mode:'normal';revision:number;history:NitroSpin[];spin:NitroSpin;bonus:NitroBonus|null;totalPayoutUnits:string;capped:boolean};
export type NitroResult = {view:NitroView;ended:boolean;credit:number;message:string;actions:{move:'nitro-spin';label:string;cost:0}[]};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,s:string)=>Object.keys(v).sort().join()===s.split(',').sort().join();
const int=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const units=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,14})$/.test(v);
export const nitroSame=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const nitroGrid=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===30&&Array.from(v).every(n=>int(n,0,8));
export const validNitroStake=(v:unknown):v is string=>typeof v==='string'&&(NITRO_BETS as readonly string[]).includes(v);
export function validNitroSettings(v:unknown):v is NitroSettings{return obj(v)&&keys(v,'nitro')&&obj(v.nitro)&&keys(v.nitro,'mode')&&v.nitro.mode==='normal';}
export function nitroGroups(grid:readonly number[]) {
 return NITRO_LINES.flatMap((path,line)=>{
  let best:{symbol:number;line:number;positions:number[];payHundredths:number}|undefined;
  for(let symbol=0;symbol<=6;symbol++){
   const positions:number[]=[];
   for(let col=0;col<6;col++){const p=path[col]*6+col,v=grid[p];if(v===symbol||(symbol!==6&&v===6))positions.push(p);else break;}
   if(positions.length<3)continue;const payHundredths=NITRO_PAYTABLE[symbol][positions.length-3];
   if(!best||payHundredths>best.payHundredths)best={symbol,line,positions,payHundredths};
  }
  return best?[best]:[];
 });
}
export function nitroSurvivors(grid:readonly number[],removed:readonly number[]){
 const gone=new Set(removed),drops:NitroDrop[]=[],empty:number[]=[];
 for(let col=0;col<6;col++){const keep=Array.from({length:5},(_,row)=>row*6+col).filter(p=>!gone.has(p)),offset=5-keep.length;for(let row=0;row<offset;row++)empty.push(row*6+col);keep.forEach((from,row)=>drops.push({from,to:(row+offset)*6+col,symbol:grid[from]}));}
 return {drops,empty};
}
export function nitroPayment(grid:readonly number[],gear:number,stake:string,remaining:bigint){
 let paid=0n,raw=0n;
 const wins:NitroWin[]=nitroGroups(grid).map(g=>{const amount=BigInt(stake)*BigInt(g.payHundredths)*BigInt(gear)/100n,award=amount<remaining-paid?amount:remaining-paid;paid+=award;raw+=amount;return {...g,factor:gear,payoutUnits:String(award),uncappedPayoutUnits:String(amount)};});
 return {wins,paid,raw};
}
/** Deterministic frame decisions are shared by settlement generation and full replay validation. */
export function nitroDecision(grid:readonly number[],gear:number,charge:number,used:boolean,index:number,stake:string,remaining:bigint){
 const payment=nitroPayment(grid,gear,stake,remaining),canisters=grid.flatMap((v,i)=>v===8?[i]:[]),energy=payment.wins.length&&!used?canisters.length:0;
 const charged=used?0:Math.min(2,charge+energy),afterGear=payment.wins.length?Math.min(5,gear+1):gear;
 const stop:NitroStop=payment.paid===remaining?'win-cap':index===NITRO_MAX_FRAMES-1?'cascade-limit':payment.wins.length?'continue':!used&&charged===2?'nitro':'no-win';
 const removed=stop==='nitro'?Array.from({length:30},(_,i)=>i):stop==='continue'?[...new Set([...payment.wins.flatMap(w=>w.positions),...canisters])].sort((a,b)=>a-b):[];
 return {...payment,energy,gear:afterGear,charge:stop==='nitro'?0:charged,used:used||stop==='nitro',stop,removed};
}
export const nitroFreeAward=(flags:number)=>flags>=5?12:flags===4?10:flags>=3?8:0;
export function validNitroSettlement(state:'active'|'settled',stake:string,spent:string,returned:string,value:unknown):value is NitroView {
 try{
  if(!validNitroStake(stake)||spent!==stake||!obj(value)||!keys(value,'kind,version,mode,revision,history,spin,bonus,totalPayoutUnits,capped')||value.kind!=='nitro-run'||value.version!==1||value.mode!=='normal'||!Array.isArray(value.history)||!int(value.history.length,1,21)||value.revision!==value.history.length||!units(value.totalPayoutUnits)||typeof value.capped!=='boolean')return false;
  const cap=BigInt(stake)*BigInt(NITRO_MAX_WIN);let total=0n,bonus:NitroBonus|null=null;
  for(let index=0;index<value.history.length;index++){
   const s=value.history[index];if(total===cap||!obj(s)||!keys(s,'index,kind,initialGrid,frames,finalGrid,multiplierBefore,multiplierAfter,flags,freeAward,payoutUnits,uncappedPayoutUnits')||s.index!==index||s.kind!==(bonus?'free':'base')||!bonus&&index!==0||bonus&&!bonus.remaining||!nitroGrid(s.initialGrid)||!nitroGrid(s.finalGrid)||!Array.isArray(s.frames)||!int(s.frames.length,1,NITRO_MAX_FRAMES)||!units(s.payoutUnits)||!units(s.uncappedPayoutUnits))return false;
   let grid=s.initialGrid,gear=bonus?2:1,charge=0,used=false,paid=0n,raw=0n;if(s.multiplierBefore!==gear)return false;
   for(let step=0;step<s.frames.length;step++){
    const f=s.frames[step];if(!obj(f)||!keys(f,'index,before,after,wins,energy,nitroBefore,nitroAfter,nitroUsedBefore,nitroUsedAfter,multiplierBefore,multiplierAfter,removed,drops,refills,payoutUnits,uncappedPayoutUnits,stop')||f.index!==step||!nitroGrid(f.before)||!nitroGrid(f.after)||!nitroSame(f.before,grid)||!Array.isArray(f.wins)||!Array.isArray(f.removed)||!Array.isArray(f.drops)||!Array.isArray(f.refills))return false;
    const expected=nitroDecision(grid,gear,charge,used,step,stake,cap-total-paid),continuing=expected.stop==='continue'||expected.stop==='nitro';
    if(!nitroSame(f.wins,expected.wins)||f.energy!==expected.energy||f.multiplierBefore!==gear||f.multiplierAfter!==expected.gear||f.nitroBefore!==charge||f.nitroAfter!==expected.charge||f.nitroUsedBefore!==used||f.nitroUsedAfter!==expected.used||f.payoutUnits!==String(expected.paid)||f.uncappedPayoutUnits!==String(expected.raw)||f.stop!==expected.stop||!nitroSame(f.removed,expected.removed)||(step===s.frames.length-1)===continuing)return false;
    if(continuing){const gravity=nitroSurvivors(grid,expected.removed),after=Array<number>(30).fill(-1);if(!nitroSame(f.drops,gravity.drops)||f.refills.length!==gravity.empty.length)return false;for(const d of gravity.drops)after[d.to]=d.symbol;for(let i=0;i<gravity.empty.length;i++){const r=f.refills[i];if(!obj(r)||!keys(r,'position,symbol')||r.position!==gravity.empty[i]||!int(r.symbol,0,8))return false;after[r.position]=r.symbol;}if(!nitroSame(f.after,after))return false;}
    else if(f.drops.length||f.refills.length||!nitroSame(f.after,grid))return false;
    gear=expected.gear;charge=expected.charge;used=expected.used;paid+=expected.paid;raw+=expected.raw;grid=f.after;
   }
   total+=paid;const flags=grid.filter(v=>v===7).length,capped=total===cap;let award=0;
   if(bonus){bonus.played++;bonus.remaining--;if(!capped&&flags>=3){award=Math.min(2,NITRO_MAX_FREE-bonus.awarded);bonus.awarded+=award;bonus.remaining+=award;}if(capped)bonus.remaining=0;}
   else if(!capped&&(award=nitroFreeAward(flags)))bonus={awarded:award,played:0,remaining:award};
   if(!nitroSame(s.finalGrid,grid)||s.multiplierAfter!==gear||s.flags!==flags||s.freeAward!==award||s.payoutUnits!==String(paid)||s.uncappedPayoutUnits!==String(raw))return false;
  }
  return nitroSame(value.spin,value.history.at(-1))&&nitroSame(value.bonus,bonus)&&value.totalPayoutUnits===String(total)&&value.capped===(total===cap)&&returned===(state==='settled'?String(total):'0')&&(state==='active')===!!(bonus?.remaining&&total<cap);
 }catch{return false;}
}
export function validNitroEnvelope(state:'active'|'settled',v:unknown):boolean{
 if(!obj(v)||!keys(v,'nitro,player,dealer,community,actions,phase,ended,message')||!obj(v.nitro)||v.phase!==Number(v.nitro.revision)+1||v.ended!==(state==='settled')||typeof v.message!=='string'||![v.player,v.dealer,v.community].every(a=>Array.isArray(a)&&a.length===0)||!Array.isArray(v.actions))return false;
 if(state==='settled')return v.actions.length===0;
 const a=v.actions[0];return v.actions.length===1&&obj(a)&&keys(a,'move,label,cost')&&a.move==='nitro-spin'&&a.cost===0&&typeof a.label==='string';
}
export function validNitroSession(v:unknown):boolean{
 return obj(v)&&keys(v,'gameId,id,returnedUnits,rulesVersion,spentUnits,stakeUnits,state,view')&&v.gameId===NITRO_GAME&&v.rulesVersion===2&&typeof v.id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.id)&&(v.state==='active'||v.state==='settled')&&typeof v.stakeUnits==='string'&&typeof v.spentUnits==='string'&&typeof v.returnedUnits==='string'&&obj(v.view)&&validNitroSettlement(v.state,v.stakeUnits,v.spentUnits,v.returnedUnits,v.view.nitro)&&validNitroEnvelope(v.state,v.view);
}
