import type { RoomScene } from '../game/RoomScene';
import { HALLS } from '../shared/world';
import type { CatAction, CatMood } from '../shared/cat';
import { catSurface } from '../shared/catSurfaces';
import './cat.css';

const MOODS: Record<CatMood,string> = {
  sleeping: 'Спит на своей подушке', 'belly-up': 'Греет пузико на подушке', walking: 'Гуляет по залу', resting: 'Отдыхает и осматривается',perched:'Отдыхает на мебели',purring:'Мурчит рядом с играющим человеком',
  petting: 'Мурчит от ласки', eating: 'Лакомится с ладони', carried: 'Обнимается и урчит', stretching: 'Мягко спрыгнула и потягивается',
  drinking: 'Пьёт водичку из своей кружки', 'eating-bowl': 'Кушает из своей миски', jumping: 'Забирается на любимое место',
  scratching: 'Точит коготки о свою когтеточку',
};
export class CatUI {
  private root = document.createElement('div');
  private keyHint: HTMLElement;
  private panel: HTMLElement;
  private status: HTMLElement;
  private location: HTMLElement;
  private hint: HTMLElement;
  private wasHugging = false;
  constructor(private scene: RoomScene) {
    this.root.className = 'cat-ui';
    this.root.innerHTML = `<p class="cat-key-hint" hidden><kbd>E</kbd> Пообщаться с Кошкой</p>
      <section class="cat-panel" id="cat-panel" aria-label="Кошка" hidden>
        <button type="button" class="cat-close" aria-label="Закрыть панель Кошки">×</button>
        <div class="cat-profile"><img alt="Звэрочка, чёрно-белая кошка" width="76" height="96"><div><h2>Кошка</h2><p>Наша Звэрочка</p><small class="cat-location"></small></div></div>
        <p class="cat-status" role="status"></p><p class="cat-hint"></p>
        <div class="cat-actions"><button type="button" data-cat-action="pet">Погладить</button><button type="button" data-cat-action="feed">Угостить с руки</button><button type="button" data-cat-action="call">Позвать</button><button type="button" data-cat-action="hug">Обнять Кошку</button><button type="button" data-cat-action="release" hidden>Отпустить · Esc</button></div>
      </section>`;
    document.querySelector('.room-panel')!.append(this.root);
    this.keyHint = this.root.querySelector('.cat-key-hint')!;
    this.panel = this.root.querySelector('.cat-panel')!;
    this.status = this.root.querySelector('.cat-status')!;
    this.location = this.root.querySelector('.cat-location')!;
    this.hint = this.root.querySelector('.cat-hint')!;
    this.root.querySelector('img')!.src = scene.catPortrait();
    this.root.querySelector<HTMLButtonElement>('.cat-close')!.onclick = () => this.setOpen(false);
    this.root.addEventListener('keydown',event => { event.stopPropagation(); if(event.key==='Escape')this.setOpen(false); });
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      if(this.scene.isHuggingCat()) {
        event.preventDefault();event.stopImmediatePropagation();this.scene.catAction('release');this.update();
      } else if(!this.panel.hidden) {
        event.preventDefault();event.stopImmediatePropagation();this.setOpen(false);
      }
    };
    document.addEventListener('keydown',escape,true);
    scene.events.once('shutdown',()=>document.removeEventListener('keydown',escape,true));
    for (const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cat-action]'))) button.onclick = () => { scene.catAction(button.dataset.catAction as CatAction);this.update(); };
    scene.onCat = () => this.update(); scene.onCatOpen = () => {
      const {near,busy}=scene.catInfo();
      if (scene.isHuggingCat() || near&&!busy) this.setOpen(true);
    };
    this.update();
  }
  private setOpen(open: boolean) {
    this.panel.hidden = !open;
    this.update();
    if (!open) document.querySelector<HTMLElement>('#game')?.focus({preventScroll:true});
  }
  private update() {
    const {cat,near,sameHall,selfId,busy} = this.scene.catInfo();
    const mine = cat.carriedBy === selfId, carried = Boolean(cat.carriedBy);
    if(mine&&!this.wasHugging)this.panel.hidden=false;
    if(!mine&&(!near||busy))this.panel.hidden=true;
    this.wasHugging=mine;
    this.keyHint.hidden = !this.panel.hidden || !near || busy;
    this.root.parentElement?.classList.toggle('cat-nearby',near&&!busy||mine);
    this.location.textContent = HALLS[cat.hall].name + ' · Этаж ' + HALLS[cat.hall].floor;
    const occupied = ['drinking','eating-bowl','scratching','jumping','stretching'].includes(cat.mood);
    const surface=catSurface(cat.surfaceId);
    this.status.textContent = cat.mood === 'carried' && !mine ? 'На руках у другого игрока' : cat.mood==='jumping' ? cat.jumpingDown?'Мягко спрыгивает на пол':cat.onBar?'Залезает на барную стойку':'Запрыгивает на своё место' : cat.mood==='perched'&&surface?surface.label:cat.mood==='walking'&&cat.targetId?'Идёт побыть рядом с человеком':MOODS[cat.mood];
    this.hint.textContent = mine ? 'Побудь с ней 5–7 секунд. Двигаться и начинать другие занятия пока нельзя. Отпустить раньше: кнопка или Esc.' : carried ? 'Кошка обнимает другого игрока. Скоро она снова пойдёт гулять.' : !sameHall ? 'Она гуляет в другом зале. Можно пойти к ней по лестнице.' : occupied ? 'Пусть спокойно закончит, потом снова сможет подойти к тебе.' : cat.onPillow ? 'На подушке её можно только погладить. На зов откликается по настроению.' : surface ? 'Она сама выбрала это место. Можно нежно погладить, а обнять получится, когда она спустится на пол.' : cat.hugCooldown>0 ? `После объятия она занимается своими делами. Обнять снова можно через ${cat.hugCooldown} с.` : !near ? 'Подойди поближе для ласки и угощения. Позвать можно из этого зала.' : 'Объятие длится 5–7 секунд на месте. Она сама выбирает, когда продолжить свои дела.';
    for (const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-cat-action]'))) {
      const action = button.dataset.catAction;
      button.hidden = action === 'release' ? !mine : action === 'hug' && mine;
      const pillowBlocked=Boolean(cat.surfaceId)&&(action==='feed'||action==='hug');
      const hugBlocked=action==='hug'&&(cat.hugCooldown>0||Boolean(cat.surfaceId)||!['walking','resting'].includes(cat.mood));
      button.disabled = action === 'release' ? !mine : busy || occupied || carried || !sameHall || pillowBlocked || hugBlocked || (action==='call'&&cat.mood==='purring') || (action !== 'call' && !near);
    }
  }
}
