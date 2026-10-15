import type { RoomScene } from '../game/RoomScene';

export class RoomLayout {
  private scene?:RoomScene;
  private panel='';
  private sidebar=document.querySelector<HTMLElement>('.sidebar')!;
  private tabs=document.querySelector<HTMLElement>('.panel-tabs')!;
  private close=document.querySelector<HTMLButtonElement>('#panel-close')!;
  constructor(){
    document.querySelector('.room-panel')!.append(this.sidebar);
    this.sidebar.id='room-sidebar';this.sidebar.hidden=true;
    this.tabs.addEventListener('click',e=>{
      const button=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button)return;
      this.setPanel(this.panel===button.id?'':button.id);
    });
    this.close.onclick=()=>this.setPanel('');
    this.sidebar.addEventListener('click',e=>{if((e.target as HTMLElement).closest('[data-cabinet],[data-variant],[data-studio],[data-card-table],[data-activity]'))this.setPanel('',false);},true);
    document.querySelector('#game')!.addEventListener('pointerdown',()=>{if(this.panel)this.setPanel('',false);},true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.panel&&!document.querySelector('dialog[open]')){e.preventDefault();this.setPanel('');}});
  }
  attach(scene:RoomScene){
    this.scene=scene;
    if(!this.tabs.children.length)this.tabs.innerHTML='<button id="games-tab" type="button" aria-expanded="false" aria-controls="room-sidebar">Игры</button>';
    this.tabs.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-expanded','false');b.setAttribute('aria-controls','room-sidebar');});
    const overview=document.querySelector<HTMLButtonElement>('#room-overview')!;
    overview.onclick=()=>{const on=overview.getAttribute('aria-pressed')!=='true';overview.setAttribute('aria-pressed',String(on));overview.textContent=on?'Вернуться к игроку':'Весь этаж';scene.setOverview(on);};
    const viewport=window.visualViewport;
    const resize=()=>{
      // Keep the drawer and composer above a mobile software keyboard.
      const height=viewport&&viewport.scale===1?viewport.height:window.innerHeight;
      document.documentElement.style.setProperty('--app-height',height+'px');
    };
    viewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);resize();
  }
  closePanels(){this.setPanel('',false);}
  private setPanel(id:string,focus=true){
    const old=this.panel;this.panel=id;this.sidebar.hidden=!id;this.close.hidden=!id;
    document.querySelector('.workspace')!.classList.toggle('panel-open',!!id);
    this.tabs.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.setAttribute('aria-expanded',String(b.id===id)));
    if(!id){
      if(this.sidebar.contains(document.activeElement))(document.activeElement as HTMLElement).blur();
      this.scene?.setTyping(false);
      if(focus)document.getElementById(old)?.focus({preventScroll:true});
    }
    this.sidebar.dispatchEvent(new Event('panelvisibility'));
  }
}
