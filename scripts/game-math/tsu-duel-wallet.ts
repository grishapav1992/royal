import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {PostgresDatabase} from '../../server/database';
import {DemoWalletStore} from '../../server/demoWallet';
import {VirtualPvpLedger} from '../../server/pvp/virtual-wallet';
import {PvpStore} from '../../server/pvp/store';
import {validVirtualPvpWallet} from '../../src/shared/pvp';
import {TSU_DUEL_STAKES} from '../../src/shared/tsuDuel';
const db=new PostgresDatabase(':memory:'),hash=createHash('sha256');let cases=0;
const rulesIndex=process.argv.indexOf('--rules'),rulesVersion=rulesIndex<0?4:Number(process.argv[rulesIndex+1]);assert([3,4].includes(rulesVersion));
const target=rulesVersion===3?3:2;
try{
  await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');const common=new DemoWalletStore(db);await common.ready;
  const ledger=new VirtualPvpLedger(db,common),store=new PvpStore(ledger);await store.ready;
  for(const choice of ['left-win','right-win','draw','cancel','disconnect-left','disconnect-right','expired','server','resign-left','resign-right','timeout-left','timeout-right'])for(const stakeUnits of TSU_DUEL_STAKES){
    const ids=[randomUUID(),randomUUID()],roomId='qualification-'+cases,actors=ids.map((accountId,i)=>({accountId,name:'Player '+i,roomId}));let now=Date.now();
    for(const id of ids){await db.prepare('INSERT INTO accounts VALUES(?)').run(id);await common.operate(id,{id:randomUUID(),kind:'deposit',amount:1000});}
    const people=actors.map(a=>({...a,connected:true,available:true}));await store.syncRoom(roomId,people,now);
    const command=(side:number,op:any)=>store.command(actors[side],{...op,id:op.id??randomUUID()},now);
    const offer={id:randomUUID(),action:'invite',gameId:'tsu-e-fa',targetId:ids[1],...(rulesVersion===4?{stakeUnits}:{})};
    const created=await command(0,offer),id=created.active!.id;
    assert.equal((await command(0,offer)).active!.id,id);
    for(const actor of actors)assert.equal((await common.snapshot(actor.accountId)).balance,1000);
    if(rulesVersion===3){
      // Replay an already accepted historical invitation in this synthetic DB.
      const row=await db.prepare('SELECT payload FROM pvp_matches WHERE id=?').get(id),saved=JSON.parse(String(row!.payload));
      saved.challenge.rulesVersion=3;saved.challenge.targetWins=3;
      await db.prepare('UPDATE pvp_matches SET payload=? WHERE id=?').run(JSON.stringify(saved),id);
    }
    const step=async(ms:number)=>{const end=now+ms;while(now<end){now=Math.min(end,now+10000);await store.syncRoom(roomId,people,now);}};
    let funded=false,last:any;
    if(choice==='expired'){await step(120001);}
    else{
      await command(1,{action:'accept',challengeId:id});
      if(rulesVersion===3)await command(0,{action:'terms',challengeId:id,stakeUnits,termsRevision:0});
      else await assert.rejects(command(0,{action:'terms',challengeId:id,stakeUnits,termsRevision:0}),/указана в приглашении/);
      const termsRevision=(await store.snapshot(actors[0],now)).active!.termsRevision!;
      if(choice==='cancel')await command(1,{action:'cancel',challengeId:id});
      else{
        await command(0,{action:'duel-ready',challengeId:id,termsRevision});
        const ready={id:randomUUID(),action:'duel-ready',challengeId:id,termsRevision};await command(1,ready);await command(1,ready);funded=true;
        for(const actor of actors)assert.equal((await common.snapshot(actor.accountId)).balance,1000-Number(stakeUnits)/1000000);
        if(choice.endsWith('win')){
          const left=choice==='left-win';
          for(let round=1;round<=target;round++){
            last={id:randomUUID(),action:'move',challengeId:id,revision:0,move:{kind:'choose',round,choice:left?'rock':'scissors'}};
            await command(0,last);const restored=new PvpStore(ledger);await restored.ready;
            assert.equal((await restored.snapshot(actors[0],now)).tsuEFa!.choice,last.move.choice);
            assert.equal((await restored.snapshot(actors[1],now)).tsuEFa!.choice,null);
            await command(1,{action:'move',challengeId:id,revision:0,move:{kind:'choose',round,choice:left?'scissors':'rock'}});
            await step(4000);if(round<target)await step(1600);
          }
          await command(0,last);
        }else if(choice.startsWith('disconnect')){people[choice==='disconnect-left'?1:0].connected=false;await step(1);await step(60001);}
        else if(choice==='draw')await step(30001);
        else if(choice.startsWith('resign'))await command(choice.endsWith('left')?1:0,{action:'resign',challengeId:id});
        else if(choice.startsWith('timeout')){await command(choice.endsWith('left')?0:1,{action:'move',challengeId:id,revision:0,move:{kind:'choose',round:1,choice:'rock'}});await step(30001);}
        else{now+=16000;await store.sweep(now);}
      }
    }
    const decisive=choice.endsWith('win')||/^(disconnect|resign|timeout)-/.test(choice),winner=choice.endsWith('-right')||choice==='right-win'?1:0;
    const expected=ids.map((_,i)=>decisive?100000-Number(stakeUnits)/10000+(i===winner?Number(stakeUnits)*1.9/10000:0):100000);
    const balances=[];for(const actor of actors){const wallet=await ledger.wallet(actor.accountId);assert(validVirtualPvpWallet(wallet));balances.push(Math.round(wallet.wallet.balance*100));}
    assert.deepEqual(balances,expected);
    const restarted=new PvpStore(ledger);await restarted.ready;const final=await restarted.snapshot(actors[0],now);assert.equal(final.active!.id,id);assert(['finished','cancelled'].includes(final.active!.status));
    const bets=Number((await db.prepare("SELECT count(*) AS n FROM demo_ledger WHERE account_id IN (?,?) AND entry_type='bet'").get(...ids))!.n);assert.equal(bets,funded?2:0);
    const bank=await db.prepare('SELECT * FROM virtual_pvp_banks WHERE match_id=?').get(id);assert.equal(Number(bank?.fee_units??0),decisive?Number(stakeUnits)/100000:0);
    hash.update(JSON.stringify({choice,stakeUnits,balances,bets,fee:Number(bank?.fee_units??0)})+'\n');cases++;
  }
  console.log('TSU_WALLET_JSON '+JSON.stringify({passed:true,gameId:'tsu-e-fa',rulesVersion,cases,replayAndRestartCases:cases,clientVerified:true,oneDebitAndCredit:true,sha256:hash.digest('hex')}));
}finally{await db.close();}
