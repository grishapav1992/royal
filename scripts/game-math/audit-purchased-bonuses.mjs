// Full paid-round screening. This does not replace formal RTP qualification.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {seededRandom} from '../../src/shared/draconaMath.ts';
import {VELVET_INFO,VELVET_FACTORS,velvetEmptyFeatures} from '../../src/shared/velvetReign.ts';
import {VELVET_MATH} from '../../server/games/velvetMath.ts';
import {velvetBoard,startVelvet,moveVelvet} from '../../server/games/velvetReign.ts';
import {LUELON_SLOT_PROFILES as CP,COSMIC_MATH_ENTRY_PER_MILLION,COSMIC_MATH_PROFILE_VERSION,getLuelonSlotRules} from '../../src/shared/luelonSlotsModels.ts';
import {luelonSlotLineWins} from '../../src/shared/luelonSlots.ts';
import {startLuelonSlotGame,moveLuelonSlotGame} from '../../server/games/luelonSlots.ts';
import {caramelSymbol,startCaramel,moveCaramel} from '../../server/games/caramelCarnival.ts';
import {caramelGroups,caramelEnergy,caramelSurvivors} from '../../src/shared/caramelCarnival.ts';
const args=process.argv.slice(2),opt=(name,fallback)=>args.includes('--'+name)?args[args.indexOf('--'+name)+1]:fallback;
const rounds=Number(opt('rounds',100000)),seeds=String(opt('seeds','1741021,3021923,4958077')).split(',').map(Number);
const filter=String(opt('games','velvet,cosmic,caramel')).split(','),stake=Number(opt('stake',10000)),replays=Number(opt('replays',64));
const selectedModes=String(opt('modes','')).split(',').filter(Boolean);
assert(Number.isSafeInteger(rounds)&&rounds>1&&Number.isSafeInteger(stake)&&stake>0&&seeds.every(Number.isSafeInteger));
const output=String(opt('output','docs/game-math/purchased-bonus-audit-20261024.json'));
const drawFor=seed=>{const r=seededRandom(seed);return max=>Math.floor(r()*max);};
function weighted(weights,draw){let n=draw(weights.reduce((a,b)=>a+b,0));for(let i=0;i<weights.length;i++){n-=weights[i];if(n<0)return i;}throw Error('Invalid weighted draw');}
function coeffs(info,grid,wild,wilds=[],global=1){
 return info.paylines.flatMap(line=>{
  const positions=line.map((r,c)=>r*info.cols+c),symbols=positions.map(p=>grid[p]);let prefix=0;while(prefix<symbols.length&&symbols[prefix]===wild)prefix++;
  let count=prefix,symbol=symbols[prefix];if(symbol!==undefined&&info.symbols[symbol].role==='ordinary'){count++;while(count<symbols.length&&(symbols[count]===symbol||symbols[count]===wild))count++;}
  else count=0;
  const ordinary=count?(info.symbols[symbol].pays[String(count)]??0):0,allwild=Math.max(info.symbols[wild].pays[String(prefix)]??0,...info.symbols.filter(s=>s.role==='ordinary'&&s.id!==symbol).map(s=>s.pays[String(prefix)]??0));
  const factorFor=n=>global*Math.max(1,wilds.reduce((sum,w)=>sum+(positions.slice(0,n).some(p=>p%info.cols===w.column&&grid[p]===wild)?w.factor:0),0));
  const a=ordinary*factorFor(count),b=allwild*factorFor(prefix),best=Math.max(a,b);return best?[best]:[];
 });
}
function pay(values,room){return Math.min(room,values.reduce((sum,n)=>sum+Math.floor(stake*n/100),0));}
function velvet(mode,draw,check=false){
 const M=VELVET_MATH,purchased=mode==='spotlight'||mode==='super-encore';let features=velvetEmptyFeatures(),remaining=purchased?10:0,bonusId=purchased?mode:null,total=0,base=0,spins=0,free=0,awarded=remaining;
 const star=()=>{const available=[0,1,2,3,4].filter(c=>!features.wilds.some(w=>w.column===c));if(available.length)features.wilds.push({column:available[draw(available.length)],factor:VELVET_FACTORS[weighted(M.starWeights,draw)]});};
 if(mode==='super-encore'){star();features.counters=[3,0];}
 do{
  const isFree=bonusId!==null,grid=velvetBoard(mode,features,bonusId,draw);for(const w of features.wilds)for(let r=0;r<4;r++)grid[r*5+w.column]=8;
  const c=coeffs(VELVET_INFO,grid,8,features.wilds);if(check)assert.deepEqual(c,luelonSlotLineWins('studio-velvet-reign',grid,features.wilds).map(w=>w.payHundredths*w.factor));
  const paid=pay(c,stake*10000-total);total+=paid;spins++;if(!isFree)base=paid;else{remaining--;free++;}
  if(total===stake*10000){remaining=0;break;}
  const gems=grid.filter(s=>s===9).length;
  if(isFree&&features.wilds.length<5){features.counters[0]+=gems;features.counters[1]+=gems;while(features.counters[1]>=3&&features.wilds.length<5){features.counters[1]-=3;star();remaining+=2;awarded+=2;}if(features.wilds.length===5)features.counters[1]=0;}
  else if(!isFree&&gems>=3){bonusId=gems>=4?'super-encore':'spotlight';features=velvetEmptyFeatures();remaining=10;awarded=10;if(bonusId==='super-encore'){star();features.counters=[3,0];}}
  assert(spins<=21);
 }while(remaining);
 return {total,base,spins,free,awarded,wilds:features.wilds};
}
const CI=getLuelonSlotRules('studio-cosmic-escape').info;
function cosmicBoard(free,draw){const grid=Array.from({length:15},()=>draw(7));for(let p=0;p<15;p++)if(draw(1000)<(free?20:3))grid[p]=7;
 if(!free){const trigger=draw(1000000)<COSMIC_MATH_ENTRY_PER_MILLION[COSMIC_MATH_PROFILE_VERSION],roll=trigger?draw(100):0,count=trigger?(roll<5?5:roll<20?4:3):draw(3),pool=[0,1,2,3,4];for(let i=0;i<count;i++){const c=pool.splice(draw(pool.length),1)[0];grid[draw(3)*5+c]=8;}}
 else for(let c=0;c<5;c++)if(draw(1000)<8)grid[draw(3)*5+c]=8;return grid;}
function cosmic(mode,draw,check=false){const purchased=mode!=='normal',md=CI.modes.find(m=>m.id===mode);let remaining=purchased?md.spins:0,bonusId=purchased?md.bonus:null,multiplier=mode==='deep-echo'?3:1,total=0,base=0,spins=0,free=0,awarded=remaining;
 const frame=(raw,isFree,echo)=>{const grid=[...raw],wilds=[];
  if(isFree){if(!echo&&draw(100)<25){const roll=draw(1000),inc=roll<800?1:roll<900?2:roll<950?3:roll<980?5:roll<995?10:roll<999?25:50;multiplier=Math.min(50,multiplier+inc);}
   for(let n=0;n<(CP.cosmicBeamAttempts[bonusId]??1);n++)if(draw(1000)<(CP.cosmicBeamPerThousand[bonusId]??346)){const c=draw(5);if(wilds.includes(c))continue;wilds.push(c);for(let r=0;r<3;r++)grid[r*5+c]=7;}}
  const c=coeffs(CI,grid,7,[],isFree?multiplier:1);if(check)assert.deepEqual(c,luelonSlotLineWins('studio-cosmic-escape',grid,[],isFree?multiplier:1).map(w=>w.payHundredths*w.factor));return c;};
 do{const isFree=bonusId!==null,raw=cosmicBoard(isFree,draw),first=frame(raw,isFree,false);let paid=pay(first,stake*10000-total);
  if(total+paid<stake*10000&&isFree&&draw(100)<(CP.cosmicEchoPerHundred[bonusId]??3)){const second=frame(cosmicBoard(true,draw),true,true);paid+=pay(second,stake*10000-total-paid);}
  total+=paid;spins++;if(isFree){remaining--;free++;}else base=paid;
  if(total===stake*10000){remaining=0;break;}
  if(!isFree){const count=raw.filter(s=>s===8).length;if(count>=3){bonusId='cosmic-chaos';remaining=count>=5?15:count===4?12:10;awarded=remaining;multiplier=1;}}
  assert(spins<=16);
 }while(remaining);return {total,base,spins,free,awarded,multiplier};}
function caramel(mode,draw){let remaining=mode==='festival'?10:0,hasBonus=remaining>0,multiplier=1,total=0,base=0,spins=0,free=0,awarded=remaining;
 do{const isFree=hasBonus;let grid=Array.from({length:30},()=>caramelSymbol(isFree,draw)),paid=0;
  for(let step=0;step<20;step++){const groups=caramelGroups(grid);if(groups.length)multiplier=Math.min(50,multiplier+caramelEnergy(grid));paid+=pay(groups.map(g=>g.payHundredths*multiplier),stake*5000-total-paid);if(total+paid===stake*5000||!groups.length)break;
   const removed=[...new Set([...groups.flatMap(g=>g.positions),...grid.flatMap((v,i)=>v>=8?[i]:[])])].sort((a,b)=>a-b),gravity=caramelSurvivors(grid,removed),next=Array(30).fill(-1);for(const d of gravity.drops)next[d.to]=d.symbol;for(const p of gravity.empty)next[p]=caramelSymbol(isFree,draw);grid=next;}
  total+=paid;spins++;if(isFree){remaining--;free++;}else base=paid;
  if(total===stake*5000){remaining=0;break;}
  const tickets=grid.filter(v=>v===7).length;
  if(isFree&&tickets>=3){const grant=Math.min(3,30-awarded);remaining+=grant;awarded+=grant;}
  else if(!isFree&&tickets>=4){hasBonus=true;remaining=10;awarded=10;multiplier=1;}
  assert(spins<=31);
 }while(remaining);return {total,base,spins,free,awarded,multiplier};}
const games=[{id:'velvet',gameId:'studio-velvet-reign',modes:VELVET_INFO.modes,fast:velvet,start:(m,d)=>startVelvet({luelon:{mode:m}},String(stake),d),move:(v,d)=>moveVelvet(v,String(stake),v.revision,'luelon-spin',undefined,d)},
 {id:'cosmic',gameId:'studio-cosmic-escape',modes:CI.modes,fast:cosmic,start:(m,d)=>startLuelonSlotGame('studio-cosmic-escape',{luelon:{mode:m}},String(stake),d),move:(v,d)=>moveLuelonSlotGame(v,String(stake),v.revision,'luelon-spin',undefined,d)},
 {id:'caramel',gameId:'studio-caramel-carnival',modes:[{id:'normal',cost:1},{id:'festival',cost:35}],fast:caramel,start:(m,d)=>startCaramel({caramel:{mode:m}},String(stake),d),move:(v,d)=>moveCaramel(v,String(stake),v.revision,d)}];
const sources=['server/games/velvetMath.ts','server/games/velvetReign.ts','src/shared/velvetReign.ts','server/games/luelonSlots.ts','src/shared/luelonSlots.ts','src/shared/luelonSlotsModels.ts','src/shared/cosmicEscapeBets.ts','server/games/caramelCarnival.ts','src/shared/caramelCarnival.ts','src/shared/velvetReignHistory.ts','src/shared/luelonSlotsLines.ts','scripts/game-math/audit-purchased-bonuses.mjs'];
const report={generatedAt:new Date().toISOString(),sourceCommit:execFileSync(process.env.ROYAL_GIT_BINARY||'git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:Object.fromEntries(sources.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')])),stakeUnits:stake,seeds,roundsPerSeed:rounds,method:'Independent optimized full-round samplers, checked with identical random streams against real server start/move and validators. Actual cost multiplier is the denominator. Approximate 95% intervals from independent complete paid rounds, no familywise adjustment. Not formal qualification. Normal modes include all organically triggered free spins. Every purchase completes all continuations. Integer award truncation and whole-round caps are applied.',results:[]};
function summary(s,cost){const mean=s.sum/s.n,se=Math.sqrt(Math.max(0,(s.sq-s.sum*s.sum/s.n)/(s.n-1)/s.n));return {...s,rtp:mean/cost,interval95:[(mean-1.96*se)/cost,(mean+1.96*se)/cost],baseRtp:s.base/s.n/cost,bonusRtp:(s.sum-s.base)/s.n/cost,profitProbability:s.profit/s.n,capProbability:s.caps/s.n};}
for(const g of games.filter(g=>filter.includes(g.id)))for(const mode of g.modes.filter(m=>!selectedModes.length||selectedModes.includes(m.id))){
 const slow=drawFor(779303+g.modes.indexOf(mode)),fast=drawFor(779303+g.modes.indexOf(mode));let checked=0;
 for(let i=0;i<replays;i++){const a=g.fast(mode.id,fast,true);let b=g.start(mode.id,slow);while(!b.ended){const v=b.view??b.luelon;b=g.move(v,slow);}const v=b.view??b.luelon;assert.equal(a.total,b.credit,g.id+' '+mode.id+' payout');assert.equal(a.spins,v.history.length);assert.equal(a.free,v.history.filter(s=>['free','free-spin'].includes(s.kind)).length);assert.equal(fast(1000000000),slow(1000000000),'Random consumption mismatch');checked++;}
 const samples=[],all={n:0,sum:0,sq:0,base:0,profit:0,caps:0,freeSpins:0,max:0};
 for(const seed of seeds){const draw=drawFor(seed),s={n:0,sum:0,sq:0,base:0,profit:0,caps:0,freeSpins:0,max:0};for(let i=0;i<rounds;i++){const a=g.fast(mode.id,draw),r=a.total/stake;s.n++;s.sum+=r;s.sq+=r*r;s.base+=a.base/stake;s.profit+=Number(r>mode.cost);s.caps+=Number(r===(g.id==='caramel'?5000:10000));s.freeSpins+=a.free;s.max=Math.max(s.max,r);}
  for(const key of Object.keys(all))all[key]=key==='max'?Math.max(all[key],s[key]):all[key]+s[key];samples.push({seed,...summary(s,mode.cost)});console.log(JSON.stringify({game:g.gameId,mode:mode.id,seed,...summary(s,mode.cost)}));}
 report.results.push({gameId:g.gameId,mode:mode.id,costMultiplier:mode.cost,serverReplayedRounds:checked,...summary(all,mode.cost),streams:samples});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({output,results:report.results.map(r=>({game:r.gameId,mode:r.mode,rtp:r.rtp,interval95:r.interval95}))}));
