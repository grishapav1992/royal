import type { RoomScene } from '../game/RoomScene';
import { CLUB_ZONES } from '../shared/clubLayout';
import { HALLS, hallLinks } from '../shared/world';
import { cabinetsInHall } from '../shared/cabinets';
import { WORLD, FLOOR } from '../shared/clubGeometry';
import './club-map.css';

export class ClubMap {
  private root=document.createElement('aside');
  private canvas=document.createElement('canvas');
  private title=document.createElement('span');
  constructor(private scene:RoomScene){
    this.root.className='club-map';this.root.setAttribute('aria-label','Карта этажа');
    const header=document.createElement('div');header.className='club-map-header';
    const toggle=document.createElement('button');toggle.type='button';toggle.textContent='Карта';toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Свернуть карту этажа');
    header.append(this.title,toggle);this.root.append(header,this.canvas);
    this.canvas.width=432;this.canvas.height=Math.round(this.canvas.width*WORLD.height/WORLD.width);this.canvas.tabIndex=0;this.canvas.setAttribute('role','button');this.canvas.setAttribute('aria-label','Открыть весь этаж');
    this.canvas.title='Нажми, чтобы посмотреть весь этаж';
    const overview=()=>{const button=document.querySelector<HTMLButtonElement>('#room-overview')!;if(button.getAttribute('aria-pressed')!=='true')button.click();};
    this.canvas.onclick=overview;this.canvas.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();overview();}};
    toggle.onclick=()=>{const visible=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(visible));toggle.setAttribute('aria-label',visible?'Свернуть карту этажа':'Показать карту этажа');this.canvas.hidden=!visible;};
    document.querySelector('#game')!.parentElement!.append(this.root);
    const update=()=>{if(scene.player&&!document.hidden)this.draw();};
    const timer=window.setInterval(update,200);scene.events.once('shutdown',()=>{clearInterval(timer);this.root.remove();});update();
  }
  private draw(){
    const state=this.scene.getState(),ctx=this.canvas.getContext('2d')!,sx=this.canvas.width/WORLD.width,sy=this.canvas.height/WORLD.height;
    const definition=HALLS[state.hall];this.title.textContent='Этаж '+definition.floor+' · '+definition.number;
    ctx.clearRect(0,0,this.canvas.width,this.canvas.height);ctx.save();ctx.scale(sx,sy);
    ctx.fillStyle='#202b33';ctx.fillRect(0,0,WORLD.width,WORLD.height);
    ctx.fillStyle='#5c5145';ctx.fillRect(FLOOR.x,FLOOR.y,FLOOR.width,FLOOR.height);
    for(const zone of CLUB_ZONES[state.hall]){ctx.fillStyle='#'+zone.color.toString(16).padStart(6,'0');ctx.fillRect(zone.x,zone.y,zone.w,zone.h);}
    for(const cabinet of cabinetsInHall(state.hall)){ctx.fillStyle=cabinet.id.startsWith('studio-')?'#86d2e5':'#e4ca8c';ctx.fillRect(cabinet.x-28,cabinet.y-35,56,45);}
    if(state.hall==='arcade'){
      ctx.font='bold 72px Arial';ctx.textAlign='center';ctx.fillStyle='#d6e6ed';ctx.fillText('STUDIO',3510,1280);
    }
    for(const link of hallLinks(state.hall)){ctx.fillStyle='#73d4ca';ctx.fillRect(link.door.entry.x-35,link.door.entry.y-12,70,24);}
    for(const guest of state.guests){ctx.fillStyle='#8da49b';ctx.beginPath();ctx.arc(guest.x,guest.y,10,0,Math.PI*2);ctx.fill();}
    const view=state.view;ctx.strokeStyle='#ece2c280';ctx.lineWidth=6;ctx.strokeRect(view.x,view.y,view.width/view.zoom,view.height/view.zoom);
    ctx.fillStyle='#f7d26a';ctx.beginPath();ctx.arc(state.x,state.y,18,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#332936';ctx.lineWidth=5;ctx.stroke();ctx.restore();
  }
}
