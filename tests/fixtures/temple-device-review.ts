/** Manual QA only. Prepared entropy is honored solely by the explicitly enabled local test stand. */
export {};
const select=document.querySelector<HTMLSelectElement>('#review-case')!;
const key='royal:temple:device-review-cases';
const allowed=['partial','bonus','cap'];
let cases:Record<string,string>={};
try{const saved=JSON.parse(sessionStorage.getItem(key)??'{}');if(saved&&typeof saved==='object')for(const [id,value]of Object.entries(saved))if(typeof value==='string'&&allowed.includes(value))cases[id]=value;}catch{}
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  if(url.origin===location.origin&&/^\/api\/(demo|game)-wallet\/expansion$/.test(url.pathname)&&init?.method==='POST'&&typeof init.body==='string'){
    try{
      const op=JSON.parse(init.body);
      if(op.gameId==='studio-flooded-temple'){
        const id=op.action==='start'?op.id:op.sessionId;
        if(typeof id==='string'){
          const choice=cases[id]??select.value;cases[id]=choice;
          cases=Object.fromEntries(Object.entries(cases).slice(-100));sessionStorage.setItem(key,JSON.stringify(cases));
          const scenario=choice==='cap'?'cascade-cap':`cascade-seed-${choice==='bonus'?118:15}-device-${id}`;
          const headers=new Headers(init.headers);headers.set('x-temple-test-case',scenario);return originalFetch(input,{...init,headers});
        }
      }
    }catch{/* Leave malformed or storage-blocked operations to the common client. */}
  }
  return originalFetch(input,init);
};

const review=document.querySelector<HTMLElement>('#review')!;
new ResizeObserver(()=>document.documentElement.style.setProperty('--review-height',review.offsetHeight+'px')).observe(review);
document.querySelector('#listening-form')!.addEventListener('submit',event=>{
  event.preventDefault();const value=(id:string)=>(document.getElementById(id) as HTMLInputElement|HTMLSelectElement).value;
  const physicallyHeard=(document.querySelector<HTMLInputElement>('#heard-physically')!).checked;
  const output=value('audio-output'),model=value('device-model').trim();
  const confirmed=physicallyHeard&&output!=='unverified'&&!!model;
  const host=document.querySelector<HTMLElement>('[data-game-module-id="studio-flooded-temple"]');
  const session=(window as any).templePreview?.client.sessions.find((s:any)=>s.gameId==='studio-flooded-temple');
  const player=(window as any).templePreview,audioContext=player?.audio.context;
  const audio={state:audioContext?.state??'unavailable',sampleRate:audioContext?.sampleRate,baseLatencyMs:audioContext?audioContext.baseLatency*1000:undefined,reportedOutputLatencyMs:audioContext?audioContext.outputLatency*1000:undefined,preferences:player?.audio.getPreferences(),music:player?.state()?.audio?.music};
  const result={format:1,date:new Date().toISOString(),module:host?.dataset.gameModuleVersion??'unavailable',scenario:cases[session?.id]??select.value,nextScenario:select.value,paidRound:session?{rulesVersion:session.rulesVersion,stakeUnits:session.stakeUnits,returnedUnits:session.returnedUnits,state:session.state,falls:session.view.templeCascade?.state.falls}:undefined,audio,device:model,output,physicallyHeard,physicalListeningConfirmed:confirmed,clarity:value('clarity'),mix:value('mix-rating'),notes:value('listening-notes'),browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},musicCredit:"Memories Of Stone, Scott Buckley, CC BY 4.0. https://www.scottbuckley.com.au/library/memories-of-stone/",testOnly:true};
  const blob=new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='temple-listening-review.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  document.querySelector('#review-status')!.textContent=confirmed?'Замечания сохранены на вашем устройстве.':'Сохранён черновик. Физическое прослушивание ещё не подтверждено.';
});

await import('./temple-preview');
