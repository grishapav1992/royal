import { t as translateText, tr } from '../i18n/index';
import {CONVOY_ASSETS} from './LastConvoyAssets';
import {CONVOY_LOOK_IDS,CONVOY_LOOK_ROUNDS,convoyLookLevel,validConvoyProgress,type ConvoyLookId,type ConvoyProgress} from '../shared/convoyWardrobe';
import {ConvoyPortraitAnimation} from './ConvoyPortraitAnimation';
import './convoy-heroine.css';

export const CONVOY_LOOKS=[
  {id:'survivor',name:translateText('Выживальщица'),src:CONVOY_ASSETS.heroine},
  {id:'recon',name:translateText('Разведчица'),src:'/assets/last-convoy/v2/recon.webp'},
  {id:'medic',name:translateText('Полевой медик'),src:'/assets/last-convoy/v2/medic.webp'},
  {id:'pilot',name:translateText('Пилот'),src:'/assets/last-convoy/v2/pilot.webp'},
  {id:'urban',name:translateText('Городской камуфляж'),src:'/assets/last-convoy/v2/urban.webp'},
  {id:'commander',name:translateText('Командир'),src:'/assets/last-convoy/v2/commander.webp'},
] as const;
type Look=typeof CONVOY_LOOKS[number];
export type HeroineMotion='idle'|'watch'|'win'|'shield'|'signal'|'evacuation';
const storageKey=(account:string)=>'royal-convoy-look-v2:'+account;

/** Account progress comes from confirmed server sessions; local storage keeps only the display choice. */
export class ConvoyHeroine{
  private selected:ConvoyLookId='survivor';
  private preferred:ConvoyLookId='survivor';
  private account:string|null=null;
  private confirmed=false;
  private rounds=0;
  private level=0;
  private seen=0;
  private loading='';
  private error='';
  private progressError='';
  private disposed=false;
  private readyState=false;
  private generation=0;
  private cancelLoad?:()=>void;
  private changed:MutationObserver;
  private viewport:ResizeObserver;
  private visibility=()=>this.update();
  private paused=false;
  private busy=false;
  private pending?:{look:Look;automatic:boolean;generation:number};
  private target?:ConvoyLookId;
  private animation:ConvoyPortraitAnimation;
  constructor(private root:HTMLElement,private galleryChanged:()=>void){
    this.animation=new ConvoyPortraitAnimation(root);
    this.changed=new MutationObserver(()=>this.update());
    this.changed.observe(root,{attributes:true,attributeFilter:['data-phase','data-charging','data-bonus','data-reduced-motion']});
    const stage=root.closest<HTMLElement>('.mini-stage')??root.parentElement!;
    this.viewport=new ResizeObserver(()=>root.style.setProperty('--cv-hero-dialog-height',`${Math.max(180,stage.clientHeight-28)}px`));this.viewport.observe(stage);
    document.addEventListener('visibilitychange',this.visibility);this.update();this.countLabel();
  }
  private get image(){return this.root.querySelector<HTMLImageElement>('[data-cv-heroine]')!;}
  ready(){
    this.readyState=true;this.image.src=CONVOY_LOOKS[0].src;this.image.alt=translateText('Майя, выживальщица с рацией');
    this.root.dataset.heroLook=this.selected;this.animation.choose(this.selected);this.resolveTarget();
  }
  setProgress(account:string|null,profile?:ConvoyProgress,error=''){
    if(this.disposed)return;
    const switched=account!==this.account;
    if(switched){
      this.generation++;this.cancelLoad?.();this.pending=undefined;this.target=undefined;this.loading='';this.error='';
      this.account=account;this.confirmed=false;this.rounds=this.level=this.seen=0;this.selected=this.preferred='survivor';
      if(account)try{
        const saved=JSON.parse(localStorage.getItem(storageKey(account))??'null');
        if(saved&&CONVOY_LOOK_IDS.includes(saved.selected)&&Number.isInteger(saved.seen)&&saved.seen>=0&&saved.seen<6){this.preferred=saved.selected;this.seen=saved.seen;}
      }catch{}
      if(this.readyState){this.image.src=CONVOY_LOOKS[0].src;this.image.alt=translateText('Майя, выживальщица с рацией');this.root.dataset.heroLook='survivor';this.animation.choose('survivor');}
    }
    const previous=this.rounds,wasConfirmed=this.confirmed,previousError=this.progressError;this.progressError=error;
    if(profile&&validConvoyProgress(profile)&&account){this.confirmed=true;this.rounds=profile.completedRounds;this.level=convoyLookLevel(this.rounds);}
    if(!switched&&previous===this.rounds&&wasConfirmed===this.confirmed&&previousError===error)return;
    if(this.confirmed){
      this.seen=Math.min(this.seen,this.level);
      if(this.level>this.seen)this.target=CONVOY_LOOK_IDS[this.level];
      else this.target=CONVOY_LOOK_IDS.indexOf(this.preferred)<=this.level?this.preferred:'survivor';
    }
    this.countLabel();this.resolveTarget();this.galleryChanged();
  }
  private countLabel(){
    this.root.dataset.heroRounds=String(this.rounds);this.root.dataset.heroUnlocked=String(this.level+1);
    const button=this.root.querySelector<HTMLButtonElement>('[data-cv-looks]');
    if(button){button.textContent=translateText('Образы Майи');button.setAttribute('aria-label',tr`Выбрать образ Майи, открыто ${this.level+1} из 6`);}
  }
  setBusy(busy:boolean){
    this.busy=busy;
    if(!busy&&this.pending){const pending=this.pending;this.pending=undefined;this.commit(pending.look,pending.automatic,pending.generation);}
    if(!busy)this.resolveTarget();
  }
  pause(paused:boolean){this.paused=paused;this.update();}
  private update(){
    if(this.disposed)return;const phase=this.root.dataset.phase;
    const motion:HeroineMotion=this.root.dataset.charging==='true'||phase==='energy'?'shield':phase==='tickets'?'signal':['winning','bursting','falling'].includes(phase??'')?'win':['accelerating','spinning','stopping'].includes(phase??'')?'watch':this.root.dataset.bonus==='true'?'evacuation':'idle';
    if(this.root.dataset.heroMotion!==motion)this.root.dataset.heroMotion=motion;
    const stopped=this.paused||document.hidden||this.root.dataset.reducedMotion==='true';this.root.dataset.heroPaused=String(stopped);
    this.animation.update(motion,stopped);
  }
  gallery(){
    const next=CONVOY_LOOK_ROUNDS[this.level+1];const previous=CONVOY_LOOK_ROUNDS[this.level];
    const progress=next===undefined?translateText('<p>Все шесть образов открыты.</p>'):tr`<p>Завершено раундов: <strong>${this.rounds}</strong>. Следующий образ после <strong>${next}</strong>.</p><progress value="${this.rounds-previous}" max="${next-previous}" aria-label="До следующего образа"></progress>`;
    return tr`<small>ЭКИПИРОВКА МАЙИ</small><h2 id="cc-dialog-title">ОБРАЗЫ МАЙИ</h2><div class="cv-look-progress">${this.account?this.confirmed?progress:translateText('<p>Проверяем завершённые раунды…</p>'):translateText('<p>Войди в клуб, чтобы сохранять открытые образы.</p>')}</div><p class="cv-looks-note">Новый образ включается после раунда. Ранее открытые можно выбрать вручную.</p><div class="cv-look-grid" role="group" aria-label="Образы Майи">${CONVOY_LOOKS.map((look,index)=>{const locked=index>this.level;return `<button type="button" class="cv-look-card" data-cc-action="look:${look.id}" data-locked="${locked}" aria-label="${look.name}${locked?tr`, откроется после ${CONVOY_LOOK_ROUNDS[index]} раундов`:''}" aria-pressed="${this.selected===look.id}" ${this.loading||locked?'disabled':''}><span class="cv-look-preview">${locked?'<span class="cv-look-lock" aria-hidden="true">◇</span>':tr`<img src="${look.src}" alt="Майя: ${look.name.toLowerCase()}" width="1024" height="1536" loading="lazy">`}</span><strong>${look.name}</strong><small>${locked?tr`${CONVOY_LOOK_ROUNDS[index]} раундов`:this.loading===look.id?translateText('Загружается…'):this.selected===look.id?translateText('Выбран'):translateText('Выбрать')}</small></button>`;}).join('')}</div><p class="cv-look-status" role="status">${this.error||this.progressError||(this.loading?translateText('Готовим новый образ…'):translateText('Одна завершённая партия вместе с бонусом считается одним раундом.'))}</p><button type="button" class="cc-primary" data-cc-action="close">ВЕРНУТЬСЯ В ИГРУ</button>`;
  }
  private resolveTarget(){
    if(this.disposed||!this.readyState||this.busy||this.loading||!this.target)return;
    const target=this.target;this.target=undefined;
    if(target!==this.selected)void this.load(target,true);
  }
  async select(id:string){
    const index=CONVOY_LOOK_IDS.indexOf(id as ConvoyLookId);
    if(index<0||index>this.level||this.disposed||this.loading||this.busy)return;
    this.target=undefined;
    if(id===this.selected){this.seen=this.level;this.preferred=this.selected;this.persist();this.animation.choose(this.selected,true);return;}
    await this.load(id as ConvoyLookId,false);
  }
  private async load(id:ConvoyLookId,automatic:boolean){
    const look=CONVOY_LOOKS.find(item=>item.id===id)!;
    const generation=++this.generation;this.loading=id;this.error='';this.pending=undefined;this.galleryChanged();
    try{
      await new Promise<void>((resolve,reject)=>{
        const image=new Image();let finished=false;
        const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);image.onload=image.onerror=null;this.cancelLoad=undefined;if(error){image.removeAttribute('src');reject(error);}else resolve();};
        const timer=setTimeout(()=>finish(new Error('timeout')),12000);this.cancelLoad=()=>finish(new Error('cancelled'));
        image.onload=()=>{void image.decode().then(()=>finish(),()=>finish(new Error('decode')));};image.onerror=()=>finish(new Error('load'));image.src=look.src;
      });
      if(this.disposed||generation!==this.generation)return;
      if(this.busy)this.pending={look,automatic,generation};else this.commit(look,automatic,generation);
    }catch{if(!this.disposed&&generation===this.generation)this.error=translateText('Не удалось загрузить образ. Прежний образ сохранён. Попробуй ещё раз.');}
    finally{if(!this.disposed&&generation===this.generation){this.loading='';this.galleryChanged();this.resolveTarget();}}
  }
  private commit(look:Look,automatic:boolean,generation:number){
    if(this.disposed||generation!==this.generation||CONVOY_LOOK_IDS.indexOf(look.id)>this.level)return;
    if(automatic&&this.target&&this.target!==look.id)return;
    this.selected=this.preferred=look.id;this.seen=this.level;this.image.src=look.src;this.image.alt=tr`Майя: ${look.name.toLowerCase()}`;this.root.dataset.heroLook=look.id;this.animation.choose(look.id);this.persist();
    this.galleryChanged();
  }
  private persist(){if(this.account)try{localStorage.setItem(storageKey(this.account),JSON.stringify({selected:this.selected,seen:this.seen}));}catch{}}
  destroy(){if(this.disposed)return;this.disposed=true;this.generation++;this.cancelLoad?.();this.changed.disconnect();this.viewport.disconnect();this.animation.destroy();document.removeEventListener('visibilitychange',this.visibility);}
}
