import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {savedSession,savedRoom,rememberSession,forgetSession} from '../src/network/sessionRecovery';
function storage(context:TestContext){
 const stores=[new Map<string,string>(),new Map<string,string>()];
 for(const [index,name]of ['sessionStorage','localStorage'].entries()){
  const original=Object.getOwnPropertyDescriptor(globalThis,name),map=stores[index];
  Object.defineProperty(globalThis,name,{configurable:true,value:{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)}});
  context.after(()=>{if(original)Object.defineProperty(globalThis,name,original);else Reflect.deleteProperty(globalThis,name);});
 }
 return {tab:stores[0],shared:stores[1],put:(map:Map<string,string>,value:unknown)=>map.set('royal-lobby-recovery',JSON.stringify(value))};
}
test('the latest rotated token can recover a room when navigation history is absent',context=>{
 const s=storage(context);s.put(s.tab,{accountId:'alice',roomId:'hall',token:'hall:old',at:100});s.put(s.shared,{accountId:'alice',roomId:'hall',token:'hall:new',at:200});
 assert.equal(savedSession('alice','hall'),'hall:new');assert.equal(savedRoom('alice'),'hall');
 assert.equal(savedSession('bob','hall'),undefined);assert.equal(savedSession('alice','other'),undefined);
});
test('a delayed event from an old socket cannot erase a newer or another accounts reservation',context=>{
 const s=storage(context);s.put(s.tab,{accountId:'alice',roomId:'hall',token:'hall:old'});s.put(s.shared,{accountId:'alice',roomId:'hall',token:'hall:new'});
 forgetSession('alice','hall','hall:old');assert.equal(s.tab.size,0);assert.equal(savedSession('alice','hall'),'hall:new');
 forgetSession('bob','hall','hall:new');assert.equal(s.shared.size,1);
 forgetSession('alice','hall','hall:new');assert.equal(s.shared.size,0);
});
test('malformed room IDs and tokens cannot become automatic connection targets',context=>{
 const s=storage(context);
 for(const value of [{roomId:'../foreign',token:'../foreign:token'},{roomId:'hall',token:'other:token'},{roomId:'hall',token:'hall:'},{roomId:'hall',token:'hall:a:b'},{roomId:'hall',token:'hall:'+ 'a'.repeat(512)}]){
  s.put(s.tab,{accountId:'alice',...value});assert.equal(savedRoom('alice'),undefined);
 }
});
test('a live reservation remains usable if one browser store is unavailable',context=>{
 const s=storage(context);Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Storage disabled');}});
 rememberSession({roomId:'hall',reconnectionToken:'hall:live'},'alice');assert.equal(savedSession('alice','hall'),'hall:live');forgetSession('alice','hall','hall:live');assert.equal(s.tab.size,0);
});
