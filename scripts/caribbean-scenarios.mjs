/** Reproducible presentation fixtures. These selected examples do not estimate RTP. */
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {startCaribbean,moveCaribbean} from '../server/games/caribbeanTreasures.ts';
export const scenarioPath=new URL('../docs/concepts/caribbean-treasures/scenarios.json',import.meta.url);
export function replayScenario({seed,mode='normal',tactic='raid'}){
 let state=seed>>>0;
 // Fixture PRNG only. Production uses the server's cryptographic RNG.
 const draw=maximum=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%maximum;};
 let result=startCaribbean({lines:20,mode},'100',draw);
 const natural=result.view.phase==='choice';
 while(!result.ended)result=moveCaribbean(result.view,result.view.revision,result.view.phase==='choice'?'choose-'+tactic:'spin',draw);
 const view=result.view,cost=BigInt(view.costUnits),payout=BigInt(view.totalPayoutUnits);
 const frames=view.spins.map(s=>s.frame);
 return{view,natural,summary:{costUnits:view.costUnits,payoutUnits:view.totalPayoutUnits,spins:view.spins.length,
  hash:createHash('sha256').update(JSON.stringify(view)).digest('hex'),
  tags:[...(payout===0n?['loss']:payout<cost?['partial']:payout===cost?['return']:['positive']),
   ...(payout>=cost*20n?['large']:[]),...(frames.some(f=>f.block?.size===2)?['giant2']:[]),
   ...(frames.some(f=>f.block?.size===3)?['giant3']:[]),...(frames.some(f=>f.cannon)?['cannon']:[]),
   ...(frames.some(f=>f.block&&(f.block.x===0||f.block.y===0||f.block.x+f.block.size===6||f.block.y+f.block.size===4))?['edge']:[])],
 }};
}
async function generate(){
 const cases=[],wanted=new Set(['loss','partial','return','positive','large','giant2','giant3','cannon','edge']);
 let bonusSeed;
 for(let seed=1;seed<=100000&&(wanted.size||!bonusSeed);seed++){
  const sample=replayScenario({seed});if(sample.natural&&!bonusSeed)bonusSeed=seed;
  for(const tag of sample.summary.tags)if(wanted.delete(tag))cases.push({name:tag,seed,mode:'normal',tactic:'raid',expected:sample.summary});
 }
 if(wanted.size||!bonusSeed)throw Error('Missing fixture categories: '+[...wanted]);
 for(const tactic of ['raid','flagship'])cases.push({name:'natural-'+tactic,seed:bonusSeed,mode:'normal',tactic,expected:replayScenario({seed:bonusSeed,tactic}).summary});
 for(const tactic of ['raid','flagship'])cases.push({name:'purchase-'+tactic,seed:92741,mode:'buy-'+tactic,tactic,expected:replayScenario({seed:92741,mode:'buy-'+tactic,tactic}).summary});
 return{format:1,rulesVersion:1,purpose:'Selected deterministic trajectories for regression and later presentation work; not an RTP sample',cases};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--write'))await writeFile(scenarioPath,JSON.stringify(await generate(),null,2)+'\n');
 const fixtures=JSON.parse(await readFile(scenarioPath,'utf8'));
 for(const scenario of fixtures.cases){if(JSON.stringify(replayScenario(scenario).summary)!==JSON.stringify(scenario.expected))throw Error('Changed fixture: '+scenario.name);}
 console.log(JSON.stringify({verifiedScenarios:fixtures.cases.length}));
}
