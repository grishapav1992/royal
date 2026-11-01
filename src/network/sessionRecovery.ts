import type { Room } from '@colyseus/sdk';

const key = 'royal-lobby-recovery';

export function savedSession(accountId: string | undefined, roomId: string | undefined): string | undefined {
  if (!accountId) return;
  const candidates:{token:string;at:number}[]=[];
  for(const storage of [()=>sessionStorage,()=>localStorage])try {
    const saved = JSON.parse(storage().getItem(key) || 'null');
    if (saved?.accountId === accountId && typeof saved.roomId==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(saved.roomId)
      && (!roomId||saved.roomId===roomId) && typeof saved.token === 'string'&&saved.token.length<512
      && saved.token.startsWith(saved.roomId + ':') && saved.token.split(':').length === 2&&saved.token.split(':')[1]) candidates.push({token:saved.token,at:Number.isFinite(saved.at)?saved.at:0});
  } catch { /* Storage may be unavailable in a private browser session. */ }
  return candidates.sort((a,b)=>b.at-a.at)[0]?.token;
}
export function savedRoom(accountId:string|undefined){return savedSession(accountId,undefined)?.split(':')[0];}

export function rememberSession(room: Pick<Room, 'roomId' | 'reconnectionToken'>, accountId?: string) {
  if (!accountId) return;
  for(const storage of [()=>sessionStorage,()=>localStorage])try { storage().setItem(key, JSON.stringify({ accountId, roomId: room.roomId, token: room.reconnectionToken,at:Date.now() })); }
  catch { /* A storage failure must not interrupt a live connection. */ }
}

export function forgetSession(accountId?:string,roomId?:string,token?:string) {
  for(const storage of [()=>sessionStorage,()=>localStorage])try {
    const store=storage();if(!accountId&&!roomId&&!token){store.removeItem(key);continue;}
    const saved=JSON.parse(store.getItem(key)||'null');
    if((!accountId||saved?.accountId===accountId)&&(!roomId||saved?.roomId===roomId)&&(!token||saved?.token===token))store.removeItem(key);
  } catch { /* Storage is optional. */ }
}
