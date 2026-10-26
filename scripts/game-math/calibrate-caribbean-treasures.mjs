import {q,add,sub,mul,div,sum,number,view} from './rational.mjs';
import {CARIBBEAN_LINES,CARIBBEAN_LINE_COUNTS,caribbeanExpansionOptions} from '../../src/shared/caribbeanTreasuresMath.ts';
import {caribbeanDraftLineMean} from './caribbean-treasures-design.mjs';
const million=q(1000000), target=q(96,100), baseTarget=q(70,100), multiplier=q(1);
const floorScaled=value=>Number(value.n*1000000n/value.d);
const ceilScaled=value=>Number((value.n*1000000n+value.d-1n)/value.d);
export function calibrateCaribbeanDraft(){
 return CARIBBEAN_LINE_COUNTS.map(lines=>{
  const mean=block=>div(sum(CARIBBEAN_LINES.slice(0,lines).map(line=>caribbeanDraftLineMean(line,block))),q(lines));
  const ordinary=mean(null), smallCases=[],largeCases=[],expandedCases=[];
  for(let y=0;y<3;y++)for(let x=0;x<5;x++){
   const block={x,y,size:2,symbol:0};smallCases.push(mean(block));
   const options=caribbeanExpansionOptions(block);
   expandedCases.push(div(sum(options.map(next=>mean(next))),q(options.length)));
  }
  for(let y=0;y<2;y++)for(let x=0;x<4;x++)largeCases.push(mean({x,y,size:3,symbol:0}));
  const small=div(sum(smallCases),q(15)),expanded=div(sum(expandedCases),q(15)),large=div(sum(largeCases),q(8));
  const baseSmall=add(mul(small,q(7,8)),mul(expanded,q(1,8)));
  const largeProbability=div(sub(sub(div(baseTarget,multiplier),ordinary),mul(q(30,100),sub(baseSmall,ordinary))),sub(large,ordinary));
  const baseLargePerMillion=floorScaled(largeProbability);
  const raidCannonProbability=div(sub(div(mul(large,q(6)),q(14)),small),sub(expanded,small));
  const raidCannonPerMillion=floorScaled(raidCannonProbability);
  const base=mul(multiplier,add(ordinary,add(mul(q(30,100),sub(baseSmall,ordinary)),mul(q(baseLargePerMillion,1000000),sub(large,ordinary)))));
  const flagshipBonus=mul(multiplier,mul(q(6),large));
  const raidBonus=mul(multiplier,mul(q(14),add(small,mul(q(raidCannonPerMillion,1000000),sub(expanded,small)))));
  const bonusEntryPerMillion=floorScaled(div(sub(target,base),flagshipBonus));
  const bonusCostPerMillion=ceilScaled(div(flagshipBonus,target));
  const expectedNormalFlagship=add(base,mul(q(bonusEntryPerMillion,1000000),flagshipBonus));
  const expectedNormalRaid=add(base,mul(q(bonusEntryPerMillion,1000000),raidBonus));
  for(const probability of [baseLargePerMillion,raidCannonPerMillion,bonusEntryPerMillion])
   if(probability<0||probability>1000000)throw Error('Unreachable calibration target');
  return {lines,baseLargePerMillion,raidCannonPerMillion,bonusEntryPerMillion,bonusCostPerMillion,
   baseRtp:view(base),flagshipBonusInBaseStakes:view(flagshipBonus),raidBonusInBaseStakes:view(raidBonus),
   expectedNormalFlagship:view(expectedNormalFlagship),expectedNormalRaid:view(expectedNormalRaid)};
 });
}
console.log(JSON.stringify(calibrateCaribbeanDraft(),null,2));
