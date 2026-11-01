import {NEOPOLIS_MATH} from './neopolisMath.ts';
import {NEOPOLIS_PAYOUT_SCALE,neopolisTeamPayout} from './neopolisStakePayouts.ts';
import {CARIBBEAN_PROFILE} from './caribbeanTreasuresMath.ts';
import {forestHeartBase,forestHeartPopcount} from './forestHeartMath.ts';
const multiplierRatio=(value:number)=>{const text=String(value);if(!Number.isFinite(value)||value<0||!/^\d+(?:\.\d{1,4})?$/.test(text))throw Error('Invalid exact multiplier');const [whole,fraction='']=text.split('.');return {numerator:BigInt(whole+fraction),denominator:10n**BigInt(fraction.length)};};

export type ExactAward = {numerator:bigint;denominator:bigint};
export type RoundPrecision = {version:1;numerator:string;denominator:string;ticket:string;baseUnits:string;creditedUnits:string};
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const units=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,30})$/.test(v);
const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a;
export function exactAward(numerator:bigint,denominator=1n):ExactAward {
 if(numerator<0n||denominator<=0n)throw Error('Invalid precise award');
 const factor=gcd(numerator,denominator);return {numerator:numerator/factor,denominator:denominator/factor};
}
const capped=(a:ExactAward,cap:bigint)=>a.numerator>cap*a.denominator?exactAward(cap):a;
/** Exact pre-cent reward from the consumed, server-validated complete transcript. */
export function expansionExactAward(s:{gameId:string;stakeUnits:string;returnedUnits:string;multiplier?:number;view:any}):ExactAward {
 const stake=BigInt(s.stakeUnits),v=s.view;
 if(v.forestHeart){
  const f=v.forestHeart,b=f.base,base=forestHeartBase(b.bits,b.ability,b.rotation);
  const points=BigInt(base.flowers*b.energy)+f.bonus.reduce((n:bigint,spin:any)=>n+BigInt(forestHeartPopcount(spin.receiverMask)*spin.energy),0n);
  return exactAward(stake*631n*points,1000n);
 }
 if(v.penalty||v.jackie){
  const c=v.penalty??v.jackie.combat;if(c.status==='lost')return exactAward(0n);
  let numerator=stake*99n,denominator=100n;
  for(const shot of c.shots){numerator*=100n;denominator*=BigInt(({safe:75,sharp:60,extreme:45}as const)[(shot.risk??c.risk)as 'safe']);}
  return exactAward(numerator,denominator);
 }
 if(v.flags){const f=v.flags;if(f.order.at(-1)!==f.country)return exactAward(0n);const count=f.version===1||f.mode==='classic'?12:f.mode==='expanded'?24:48;return exactAward(stake*BigInt(count)*24n,25n);}
 if(v.templeCascade)return exactAward(stake*BigInt(v.templeCascade.state.totalPoints),20n);
 if(v.caribbean){
  // Every allowed total stake and paytable factor settles exactly across 1/5/10/20 lines.
  const c=v.caribbean;
  if(c.version===2&&c.settings.mode!=='normal')return exactAward(BigInt(c.totalPayoutUnits)*BigInt(c.costUnits)*1000000n,stake*BigInt(CARIBBEAN_PROFILE[c.settings.lines as 1|5|10|20].bonusCostPerMillion));
  return exactAward(BigInt(c.totalPayoutUnits));
 }
 if(v.neopolis){
  const n=v.neopolis,points=n.history.reduce((sum:bigint,spin:any)=>sum+BigInt(spin.result.points),0n);
  return capped(exactAward(stake*points*neopolisTeamPayout(n.origin),40n*BigInt(NEOPOLIS_MATH.payDenominator)*NEOPOLIS_PAYOUT_SCALE),stake*3000n);
 }
 if(v.dracona){
  let points=0n;
  for(const spin of v.dracona.history)for(const step of spin.result.steps)if(step.type==='win')for(const c of step.clusters){
   const size=c.cells.length,scale=size<=6?25:size<=8?55:size<=11?120:size<=15?300:800;
   points+=BigInt(scale)*BigInt([13,12,11,10,9,8][c.symbol])*BigInt(c.factor);
  }
  return capped(exactAward(stake*points*497300n,100000000n),stake*100000n);
 }
 const slot=v.caramel??v.convoy??v.nitro??v.afterglow??v.luelon;
 if(slot){
  let points=0n;for(const spin of slot.history)for(const frame of spin.frames)for(const win of frame.wins)points+=BigInt(win.payHundredths)*BigInt(win.factor);
  const cap=v.nitro?3000:v.luelon?(s.gameId==='studio-velvet-reign'?10000:10000):5000;
  return capped(exactAward(stake*points,100n),stake*BigInt(cap));
 }
 if(s.gameId==='github-crash'){
  if(!s.multiplier)return exactAward(0n);const ratio=multiplierRatio(s.multiplier);return exactAward(stake*ratio.numerator,ratio.denominator);
 }
 return exactAward(BigInt(s.returnedUnits));
}
export function coreExactAward(round:{stakeUnits:string;multiplier:number}):ExactAward {
 const ratio=multiplierRatio(round.multiplier);return exactAward(BigInt(round.stakeUnits)*ratio.numerator,ratio.denominator);
}
/** Rejection sampling is uniform even when the exact denominator exceeds the RNG's limit. */
export function drawPrecisionTicket(denominator:bigint,draw:(maximum:number)=>number):bigint {
 const bounded=(max:number)=>{const n=draw(max);if(!Number.isSafeInteger(n)||n<0||n>=max)throw Error('Invalid precision entropy');return BigInt(n);};
 if(denominator===1n)return 0n;
 if(denominator<281474976710656n)return bounded(Number(denominator));
 const bits=denominator.toString(2).length,chunks=Math.ceil(bits/26),space=1n<<BigInt(chunks*26),limit=space-space%denominator;
 for(let attempt=0;attempt<1024;attempt++){let n=0n;for(let i=0;i<chunks;i++)n=(n<<26n)+bounded(67108864);if(n<limit)return n%denominator;}
 throw Error('Precision entropy rejection limit');
}
export function precisionCredit(a:ExactAward,ticket:bigint):bigint {
 if(ticket<0n||ticket>=a.denominator)throw Error('Invalid precision ticket');
 return a.numerator/a.denominator+(ticket<a.numerator%a.denominator?1n:0n);
}
export function makeRoundPrecision(a:ExactAward,baseUnits:string,draw:(maximum:number)=>number):RoundPrecision {
 const base=BigInt(baseUnits);if(base>a.numerator/a.denominator)throw Error('Precision cannot reduce an accepted award');
 const ticket=drawPrecisionTicket(a.denominator,draw),credit=precisionCredit(a,ticket);
 return {version:1,numerator:String(a.numerator),denominator:String(a.denominator),ticket:String(ticket),baseUnits,creditedUnits:String(credit)};
}
export function validRoundPrecision(p:unknown,a:ExactAward,credit:string):p is RoundPrecision {
 try{return object(p)&&Object.keys(p).sort().join(',')==='baseUnits,creditedUnits,denominator,numerator,ticket,version'&&p.version===1
  &&[p.numerator,p.denominator,p.ticket,p.baseUnits,p.creditedUnits].every(units)&&p.numerator===String(a.numerator)&&p.denominator===String(a.denominator)
  &&BigInt(p.baseUnits)<=a.numerator/a.denominator&&p.creditedUnits===credit&&credit===String(precisionCredit(a,BigInt(p.ticket)));}catch{return false;}
}
/** Validate the final receipt before passing its original transcript to historical validators. */
export function precisionBaseSession<T>(value:T):T|null {
 try{if(!object(value)||!Object.hasOwn(value,'precision'))return value;
  if(value.state!=='settled'||!validRoundPrecision(value.precision,expansionExactAward(value as any),value.returnedUnits))return null;
  const {precision,...base}=value;return {...base,returnedUnits:precision.baseUnits} as T;
 }catch{return null;}
}
export function precisionBaseRound<T>(value:T):T|null {
 try{if(!object(value)||!Object.hasOwn(value,'precision'))return value;
  if(!validRoundPrecision(value.precision,coreExactAward(value as any),value.payoutUnits))return null;
  const {precision,...base}=value;return {...base,payoutUnits:precision.baseUnits} as T;
 }catch{return null;}
}
export const confirmedPayout=(session:{state:string;returnedUnits:string}|undefined,fallback:string):string=>session?.state==='settled'?session.returnedUnits:fallback;
