import {type APIRequestContext} from '@playwright/test';
import {Client} from '@colyseus/sdk';

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
 for(const name of ['chat','activities','piano-note','notice','chat-check','security','ejected'])room.onMessage(name,()=>{});
 return {room,cookie};
}
