import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ExpansionView } from '../../src/shared/casinoExpansion';
export type CardReply = {payload:unknown;view:ExpansionView;debit:number;credit:number;scale:number;error?:string};
export function cardEngine(game:string,move:string,payload?:unknown,picks?:number[],side=false,rulesVersion:1|2=2):Promise<CardReply> {
  if(rulesVersion!==1&&rulesVersion!==2)throw new RangeError('Unknown card rules version');
  return new Promise((accept,reject)=>{
    const path=rulesVersion===1?(process.env.ROYAL_CARD_ENGINE_V1||resolve('dist-server/card-engine-v1')):(process.env.ROYAL_CARD_ENGINE||resolve('dist-server/card-engine'));
    const child=spawn(path,[],{stdio:['pipe','pipe','pipe']});
    let output='',diagnostic='';const timer=setTimeout(()=>{child.kill();reject(new Error('Card engine timed out'));},10000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1_000_000)child.kill();});
    child.stderr.on('data',chunk=>{diagnostic+=chunk;if(diagnostic.length>10000)child.kill();});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{
      clearTimeout(timer);try{
        if(code!==0||output.length>1_000_000)throw Error('Card engine failed');
        const r=JSON.parse(output) as CardReply;
        if(r.error){accept(r);return;}
        if(!r.view||!r.payload||![r.debit,r.credit,r.scale].every(Number.isSafeInteger)||r.debit<0||r.credit<0||![5,100,1000].includes(r.scale))throw Error('Invalid card accounting');
        accept(r);
      }catch(error){reject(error);}
    });
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({game,move,payload,picks,side}));
  });
}
