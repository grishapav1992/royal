import test from 'node:test';import assert from 'node:assert/strict';
import{savedSession,savedRoom,rememberSession,forgetSession}from'../src/network/sessionRecovery';
test('reload, a fresh tab and a root URL recover only the same account and room; explicit leave clears both caches',()=>{
 const descriptors=['sessionStorage','localStorage'].map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 const memory=()=>{const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key),clear:()=>values.clear()};};
 const session=memory(),local=memory();Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:session});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:local});
 try{
  rememberSession({roomId:'room123',reconnectionToken:'room123:secret-reservation'},'account-a');
  assert.equal(savedSession('account-a','room123'),'room123:secret-reservation');assert.equal(savedSession('account-b','room123'),undefined);assert.equal(savedSession('account-a','other-room'),undefined);
  session.clear();assert.equal(savedSession('account-a','room123'),'room123:secret-reservation');assert.equal(savedRoom('account-a'),'room123');assert.equal(savedRoom('account-b'),undefined);
  session.setItem('royal-lobby-recovery',JSON.stringify({accountId:'account-a',roomId:'room123',token:'room123:older',at:1}));
  local.setItem('royal-lobby-recovery',JSON.stringify({accountId:'account-a',roomId:'room123',token:'room123:rotated',at:2}));
  assert.equal(savedSession('account-a','room123'),'room123:rotated');forgetSession('account-a','room123','room123:older');assert.equal(savedSession('account-a','room123'),'room123:rotated');
  forgetSession();assert.equal(savedSession('account-a','room123'),undefined);
  local.setItem('royal-lobby-recovery',JSON.stringify({accountId:'account-a',roomId:'room123',token:'other-room:secret'}));assert.equal(savedRoom('account-a'),undefined);
  local.setItem('royal-lobby-recovery',JSON.stringify({accountId:'account-a',roomId:'../room',token:'../room:secret'}));assert.equal(savedRoom('account-a'),undefined);
  local.setItem('royal-lobby-recovery','broken JSON');forgetSession();assert.equal(local.getItem('royal-lobby-recovery'),null);
 }finally{for(const [index,key]of ['sessionStorage','localStorage'].entries()){const descriptor=descriptors[index];if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
