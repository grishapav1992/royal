import {expect,type APIRequestContext} from '@playwright/test';
import {Client} from '@colyseus/sdk';
import {ROOM_CHAT_PROTOCOL,type ChatVisit} from '../src/shared/chat';

export const OFFENSIVE_CHAT_BURST = 'fuck shit Scheiße putain coño cazzo kurwa caralho klootzak idiot';

export async function securityRoom(request: APIRequestContext, cookie?: string) {
 if(!cookie){
  const response=await request.post('/api/auth/login',{data:{email:`security-room-${crypto.randomUUID()}@example.test`,password:'Royal-test-123!'}});
  cookie=response.headers()['set-cookie'].split(';')[0];
  await request.post('/api/auth/character',{data:{skin:0}});
 }
 const client=new Client(process.env.TEST_BASE_URL||'http://127.0.0.1:2567',{headers:{Cookie:cookie},fetchFn:async(url,options)=>{
  const response=await request.fetch(String(url),{method:options?.method,headers:Object.fromEntries(new Headers(options?.headers)),data:options?.body as string});
  return new Response(await response.body(),{status:response.status(),headers:response.headers()});
 }});
 const room=await client.create<any>('lobby');
 let visit:ChatVisit|null|undefined;
 room.onMessage('*',()=>{});
 room.onMessage('chat-visit',value=>{visit=value;});
 room.send('history',{version:ROOM_CHAT_PROTOCOL});
 try{await expect.poll(()=>visit!==undefined,{timeout:10000}).toBe(true);}
 catch(error){await room.leave();throw error;}
 const sendChat=(text:string)=>{
  if(!visit)throw new Error('The test client has no active chat visit');
  const id=crypto.randomUUID();room.send('chat',{id,text,visitId:visit.id});return id;
 };
 return {room,cookie,sendChat};
}
