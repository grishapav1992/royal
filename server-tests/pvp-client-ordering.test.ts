import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PvpClient} from '../src/network/PvpClient';
import {VIRTUAL_PVP_SCOPE,type PvpSnapshot,type VirtualPvpWallet} from '../src/shared/pvp';

test('late command acknowledgements clear pending without rolling back settled balance, game or clock',()=>{
  const storage=new Map<string,string>();
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
  try{
    const id=randomUUID(),account=randomUUID(),client=new PvpClient(()=>true);
    const wallet=(balance:number,revision:number):VirtualPvpWallet=>({scope:VIRTUAL_PVP_SCOPE,state:'assigned',ready:true,balanceUnits:String(Math.round(balance*100)*10000),reservedUnits:'0',wallet:{balance,revision,entries:[]}});
    const snapshot=(revision:number,now:number,balance:number,walletRevision:number):PvpSnapshot=>({active:{id,revision,status:revision>=5?'finished':'playing'}as PvpSnapshot['active'],challenges:[],people:[],cards:null,tsuEFa:null,wallet:wallet(balance,walletRevision),now});
    client.setAccount(account);client.setConnected(true);
    const op={id:randomUUID(),action:'resign' as const,challengeId:id};client.send(op);
    client.receive(snapshot(5,2000,200.09,3));
    client.receive({...snapshot(4,2000,199.9,2),requestId:op.id});
    assert.equal(client.pending,undefined);assert.equal(storage.size,0);
    assert.equal(client.snapshot!.active!.status,'finished');assert.equal(client.snapshot!.wallet.balanceUnits,'200090000');assert.equal(client.snapshot!.now,2000);
    client.receive({...snapshot(3,1000,199.9,2),active:null});
    assert.equal(client.snapshot!.active!.id,id);assert.equal(client.snapshot!.now,2000);
    client.receive(snapshot(5,2100,199.9,2));
    assert.equal(client.snapshot!.wallet.balanceUnits,'200090000');assert.equal(client.snapshot!.now,2100);
  }finally{Reflect.deleteProperty(globalThis,'sessionStorage');}
});
