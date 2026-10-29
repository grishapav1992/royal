/** Optional local-stand cookie isolation. Production cookie and origin rules stay in the backend. */
export function templePreviewCookies(namespace?:string){
  if(namespace&&!/^[a-z0-9_-]{1,40}$/.test(namespace))throw Error('Invalid local preview cookie namespace');
  const scoped=namespace?'royal_session_'+namespace:undefined;
  return {
    scoped,
    request(header:string|undefined){
      if(!scoped)return header;
      return (header??'').split(';').map(s=>s.trim()).filter(Boolean).filter(s=>!s.startsWith('royal_session=')).map(s=>s.startsWith(scoped+'=')?'royal_session='+s.slice(scoped.length+1):s).join('; ');
    },
    response(headers:string[]|undefined){return scoped?headers?.map(s=>s.replace(/^royal_session=/,scoped+'=')):headers;},
  };
}
