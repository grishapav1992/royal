import {WALLET_ACCOUNT_HEADER} from '../../src/shared/walletAccount';
import {STAR_CHARACTERS,starCharacter,isStarSide,type StarCollection,type StarRequest,type StarSide,type StarText} from '../../src/shared/starSpinCollection';
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const starImage=(id:string)=>`/assets/wild-nudge/characters/${id}.webp`;
class ApiError extends Error{}
async function request(account:string,signal:AbortSignal,body?:StarRequest):Promise<StarCollection>{
 const timeout=new AbortController(),abort=()=>timeout.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();const timer=setTimeout(abort,10000);
 try{const response=await fetch('/api/star-spin/collection',{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',signal:timeout.signal,headers:{[WALLET_ACCOUNT_HEADER]:account,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw new ApiError(typeof data.error==='string'?data.error:'collection-unavailable');
  if(data.version!==1||data.accountId!==account||!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.owned)||!data.owned.every((id:unknown)=>!!starCharacter(id))||!STAR_CHARACTERS.every(c=>data.owned.includes(c.id))||data.side!==null&&!isStarSide(data.side)||!data.selectedBySide||!['light','dark'].every(side=>{const c=starCharacter(data.selectedBySide[side]);return c?.side===side&&data.owned.includes(c.id);})||data.selected!==(data.side?data.selectedBySide[data.side]:null))throw new Error('collection-unavailable');return data;
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export class StarSpinCollection{
 private profile?:StarCollection;private owner='';private abort=new AbortController();private lifetime=new AbortController();private generation=0;private dead=false;private busy=false;private error='';private pending?:StarRequest;private priorFocus?:HTMLElement;private dialog:HTMLDialogElement;private paintedDialog='';
 constructor(private root:HTMLElement,private lang:()=> 'ru'|'en',private canChange:()=>boolean,private changed:()=>void,private beforeOpen:()=>void){
  this.dialog=document.createElement('dialog');this.dialog.className='gn-modal ss-dialog';this.dialog.setAttribute('aria-label','Star Spin');this.root.append(this.dialog);
  const clicked=(event:Event)=>{const b=(event.target as Element).closest<HTMLButtonElement>('button[data-ss]');if(b&&!b.disabled)this.action(b.dataset.ss!);};
  this.dialog.addEventListener('click',clicked,{signal:this.lifetime.signal});
  this.root.addEventListener('click',event=>{if(!this.dialog.contains(event.target as Node))clicked(event);},{signal:this.lifetime.signal});
  this.dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();},{signal:this.lifetime.signal});
  this.dialog.addEventListener('close',()=>{this.priorFocus?.focus();this.changed();},{signal:this.lifetime.signal});
 }
 private text(ru:string,en:string){return this.lang()==='en'?en:ru;}
 private local(t:StarText){return esc(t[this.lang()]);}
 get open(){return this.dialog.open;}
 get locksPlay(){return this.busy||!!this.pending;}
 get state(){return{side:this.profile?.side??null,selected:this.profile?.selected??null,owned:this.profile?.owned??[],loading:this.busy,pending:!!this.pending};}
 sync(account:string){if(this.dead)return;if(account!==this.owner){this.owner=account;this.generation++;this.abort.abort();this.abort=new AbortController();this.profile=undefined;this.pending=undefined;this.busy=false;this.error='';this.paintedDialog='';if(this.dialog.open)this.dialog.close();if(account)void this.load();}this.paint();}
 private async load(){if(!this.owner||this.busy||this.dead)return;const owner=this.owner,generation=this.generation;this.busy=true;this.error='';this.paint();this.changed();try{const profile=await request(owner,this.abort.signal);if(this.dead||generation!==this.generation||owner!==this.owner)return;this.profile=profile;}catch(e){if(!this.dead&&generation===this.generation)this.error=e instanceof Error?e.message:'collection-unavailable';}finally{if(!this.dead&&generation===this.generation){this.busy=false;this.paint();this.changed();}}}
 show(){if(this.dead)return;this.beforeOpen();this.priorFocus=document.activeElement as HTMLElement;this.paintDialog();if(!this.dialog.open)this.dialog.showModal();if(!this.profile&&!this.busy)void this.load();this.changed();}
 private action(action:string){
  if(action==='close'){this.dialog.close();return;}if(action==='open'){this.show();return;}
  if(action==='retry'){if(this.pending)void this.operate(this.pending);else void this.load();return;}
  if(!this.profile||this.busy||this.pending||!this.canChange())return;
  if(action==='side:light'||action==='side:dark')void this.operate({id:crypto.randomUUID(),action:'side',side:action.slice(5) as StarSide});
  else if(action.startsWith('select:')){const c=starCharacter(action.slice(7));if(c&&this.profile.owned.includes(c.id)&&c.id!==this.profile.selected)void this.operate({id:crypto.randomUUID(),action:'select',characterId:c.id});}
 }
 private async operate(body:StarRequest){
  if(this.dead||this.busy||!this.owner)return;const owner=this.owner,generation=this.generation;this.pending=body;this.busy=true;this.error='';this.paint();this.changed();
  try{const next=await request(owner,this.abort.signal,body);if(this.dead||generation!==this.generation||owner!==this.owner)return;const prior=this.profile?.selected;this.profile=next;this.pending=undefined;if(prior!==next.selected)queueMicrotask(()=>{if(!this.dead&&generation===this.generation)this.root.dispatchEvent(new Event('star-spin-selected'));});}
  catch(e){if(this.dead||generation!==this.generation)return;this.error=e instanceof Error?e.message:'collection-unavailable';if(e instanceof ApiError)this.pending=undefined;}
  finally{if(!this.dead&&generation===this.generation){this.busy=false;this.paint();this.changed();}}
 }
 private paint(){
  const c=starCharacter(this.profile?.selected);this.root.dataset.side=this.profile?.side??'neutral';this.root.dataset.character=c?.id??'';
  const portrait=this.root.querySelector<HTMLImageElement>('[data-ss-portrait]');if(portrait){portrait.hidden=!c;if(c){const src=starImage(c.id);if(portrait.getAttribute('src')!==src)portrait.src=src;portrait.alt=c.name[this.lang()];}}
  const name=this.root.querySelector('[data-ss-name]');if(name)name.textContent=c?.name[this.lang()]??this.text('Выбери героиню','Choose your companion');
  const label=this.root.querySelector('[data-ss-label]');if(label)label.textContent=c?(c.side==='light'?this.text('Светлая сторона · Джедаи','Light side · Jedi'):this.text('Тёмная сторона · Ситхи','Dark side · Sith')):this.text('Джедаи или ситхи?','Jedi or Sith?');
  const neutral=this.root.querySelector<HTMLElement>('.ss-neutral');if(neutral)neutral.hidden=!!c;
  this.root.querySelectorAll<HTMLButtonElement>('[data-ss^="side:"]').forEach(b=>{const side=b.dataset.ss!.slice(5);b.setAttribute('aria-pressed',String(this.profile?.side===side));b.disabled=this.busy||!!this.pending||!this.profile||!this.canChange();});
  if(this.dialog.open)this.paintDialog();
 }
 private paintDialog(){
  const p=this.profile,disabled=this.busy||!!this.pending||!this.canChange();
  const warning=this.error?this.pending?this.text('Не удалось сохранить выбор. Нажми «Повторить».','Could not save your choice. Select Retry.'):this.text('Не удалось загрузить героинь. Нажми «Обновить».','Could not load companions. Select Refresh.'):this.busy?this.text('Подожди…','Please wait…'):!this.canChange()?this.text('Заверши вращение или бонус, чтобы сменить героиню.','Finish the spin or bonus before changing companions.'):'';
  const focus=this.dialog.querySelector<HTMLButtonElement>(':focus')?.dataset.ss,scroll=this.dialog.scrollTop;
  const html=`<header><h3>${this.text('Выбери героиню','Choose your companion')}</h3><button data-ss="close" aria-label="${this.text('Закрыть выбор героини','Close companion selection')}">×</button></header>
   <p class="ss-notice" role="status" ${!warning?'hidden':''}>${esc(warning)}</p>
   ${this.error?`<button data-ss="retry" ${this.busy?'disabled':''}>${this.pending?this.text('Повторить','Retry'):this.text('Обновить','Refresh')}</button>`:''}
   <div class="ss-cards">${STAR_CHARACTERS.map(c=>{const selected=p?.selected===c.id;return`<article class="ss-card" data-ss-card="${c.id}" data-selected="${selected}"><div class="ss-art"><img src="${starImage(c.id)}" alt="${this.local(c.name)}" loading="eager"></div><div class="ss-card-name"><small>${c.side==='light'?this.text('Джедай','Jedi'):this.text('Ситх','Sith')}</small><h4>${this.local(c.name)}</h4></div><button data-ss="select:${c.id}" aria-pressed="${selected}" ${disabled||!p?.owned.includes(c.id)?'disabled':''}>${selected?this.text('Выбрана','Selected'):this.text('Выбрать','Select')}</button></article>`;} ).join('')}</div>`;
  if(html===this.paintedDialog)return;
  this.paintedDialog=html;this.dialog.innerHTML=html;
  if(focus)this.dialog.querySelectorAll<HTMLButtonElement>('[data-ss]').forEach(b=>{if(b.dataset.ss===focus)b.focus({preventScroll:true});});
  this.dialog.scrollTop=scroll;
 }
 destroy(){this.dead=true;this.generation++;this.abort.abort();this.lifetime.abort();if(this.dialog.open)this.dialog.close();this.dialog.remove();}
}
