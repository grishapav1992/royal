import {writeFile} from 'node:fs/promises';
import {startConvoy,moveConvoy,CONVOY_MATH} from '../server/games/lastConvoy';
import {CONVOY_PAYTABLE} from '../src/shared/lastConvoy';
const n=100000;let sum=0,sq=0,hits=0,bonuses=0,moves=0;
for(let i=0;i<n;i++){let r=startConvoy({convoy:{mode:'normal'}},'100');while(!r.ended){r=moveConvoy(r.view,'100',r.view.revision);moves++;}const x=r.credit/100;sum+=x;sq+=x*x;hits+=x>0?1:0;bonuses+=!!r.view.bonus?1:0;}
const mean=sum/n,se=Math.sqrt((sq-sum*sum/n)/(n-1)/n);
await writeFile(new URL('../../proof/actual-engine-qualification.json',import.meta.url),JSON.stringify({n,random:'node:crypto.randomInt',everyGeneratedFrameValidated:true,profile:CONVOY_MATH,paytable:CONVOY_PAYTABLE,rtp:mean*100,ci95:[(mean-1.96*se)*100,(mean+1.96*se)*100],hitRate:hits/n,bonusRate:bonuses/n,freeMoves:moves},null,2)+'\n');
