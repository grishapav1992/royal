import { t as translateText } from '../i18n/index';
import type { RoomScene } from '../game/RoomScene';
import { CLUB_ZONES, ARCADE_OVERVIEW_SIZE, LOUNGES } from '../shared/clubLayout';
import { BAR_SOLID } from '../shared/furniture';
import { ACTIVITIES } from '../shared/activities';
import { HALLS, hallLinks } from '../shared/world';
import { cabinetsInHall } from '../shared/cabinets';
import { isCardGame } from '../shared/cardTables';
import { WORLD, FLOOR } from '../shared/clubGeometry';
import './club-map.css';

export class ClubMap {
  private root=document.createElement('aside');
  private canvas=document.createElement('canvas');
  private title=document.createElement('span');
  constructor(private scene:RoomScene){
    this.root.className='club-map';this.root.setAttribute('aria-label',translateText('Карта этажа'));
    const header=document.createElement('div');header.className='club-map-header';
    const toggle=document.createElement('button');toggle.type='button';toggle.textContent=translateText('Карта зала');toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label',translateText('Свернуть карту этажа'));
    header.append(this.title,toggle);this.root.append(header,this.canvas);
    this.canvas.width=432;this.canvas.height=Math.round(this.canvas.width*WORLD.height/WORLD.width);this.canvas.tabIndex=0;this.canvas.setAttribute('role','button');this.canvas.setAttribute('aria-label',translateText('Открыть весь этаж'));
    this.canvas.title=translateText('Нажми, чтобы посмотреть весь этаж');
    const overview=()=>{const button=document.querySelector<HTMLButtonElement>('#room-overview')!;if(button.getAttribute('aria-pressed')!=='true')button.click();};
    this.canvas.onclick=overview;this.canvas.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();overview();}};
    toggle.onclick=()=>{const visible=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(visible));toggle.setAttribute('aria-label',visible?translateText('Свернуть карту этажа'):translateText('Показать карту этажа'));this.canvas.hidden=!visible;};
    document.querySelector('#game')!.parentElement!.append(this.root);
    const update=()=>{if(scene.player&&!document.hidden)this.draw();};
    const timer=window.setInterval(update,200);scene.events.once('shutdown',()=>{clearInterval(timer);this.root.remove();});update();
  }
  private draw(){
    const state=this.scene.getState(),size=state.hall==='arcade'?ARCADE_OVERVIEW_SIZE:WORLD;
    const height=Math.round(this.canvas.width*size.height/size.width);
    if(this.canvas.height!==height)this.canvas.height=height;
    const ctx=this.canvas.getContext('2d')!,sx=this.canvas.width/size.width,sy=this.canvas.height/size.height;
    const definition=HALLS[state.hall];this.title.textContent=translateText('Этаж ')+definition.floor+' · '+definition.number;
    ctx.clearRect(0,0,this.canvas.width,this.canvas.height);ctx.save();ctx.scale(sx,sy);
    ctx.fillStyle='#202b33';ctx.fillRect(0,0,WORLD.width,WORLD.height);
    ctx.fillStyle='#5c5145';ctx.fillRect(FLOOR.x,FLOOR.y,FLOOR.width,FLOOR.height);
    for(const zone of CLUB_ZONES[state.hall]){ctx.fillStyle='#'+zone.color.toString(16).padStart(6,'0');ctx.fillRect(zone.x,zone.y,zone.w,zone.h);}
    for(const lounge of LOUNGES.filter(lounge=>lounge.hall===state.hall)){
      ctx.fillStyle='#ba8793';ctx.fillRect(lounge.x-99,lounge.y-98,198,98);
      ctx.fillStyle='#d0b47b';ctx.fillRect(lounge.x-52,lounge.y+56,104,62);
    }
    if(state.hall==='arcade'){
      ctx.fillStyle='#d0b47b';ctx.fillRect(BAR_SOLID.x,BAR_SOLID.y,BAR_SOLID.w,BAR_SOLID.h);
      const piano=ACTIVITIES.piano.bounds;ctx.fillStyle='#252a30';ctx.fillRect(piano.x,piano.y,piano.w,piano.h);
    }
    for(const cabinet of cabinetsInHall(state.hall)){
      if(isCardGame(cabinet.id)){
        ctx.fillStyle='#71c9b0';ctx.beginPath();ctx.ellipse(cabinet.x,cabinet.y-47,112,50,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#f2d3a2';ctx.beginPath();ctx.arc(cabinet.x,cabinet.y-103,14,0,Math.PI*2);ctx.fill();
      }else{ctx.fillStyle=({royal:'#86d2e5',github:'#a1d9b8',casinoapipro:'#e4ca8c',luelon:'#cfafe4'} as Record<string,string>)[cabinet.collection??'']??'#e4ca8c';ctx.fillRect(cabinet.x-28,cabinet.y-35,56,45);}
    }
    if(state.hall==='github'){
      ctx.font='bold 64px Arial';ctx.textAlign='center';ctx.fillStyle='#d6e6ed';ctx.fillText(translateText('КАРТОЧНЫЙ САЛОН'),2500,838);
    }
    if(state.hall==='arcade'){
      ctx.font='bold 48px Arial';ctx.textAlign='center';ctx.fillStyle='#d6e6ed';
      for(const zone of CLUB_ZONES.arcade.filter(zone=>zone.x>=1100)){
        ctx.font='bold 34px Arial';ctx.fillText(zone.name,zone.x+zone.w/2,zone.y+zone.h-20);
      }
    }
    for(const link of hallLinks(state.hall)){ctx.fillStyle='#73d4ca';ctx.fillRect(link.door.entry.x-35,link.door.entry.y-12,70,24);}
    for(const guest of state.guests){ctx.fillStyle='#8da49b';ctx.beginPath();ctx.arc(guest.x,guest.y,10,0,Math.PI*2);ctx.fill();}
    const view=state.view;ctx.strokeStyle='#ece2c280';ctx.lineWidth=6;ctx.strokeRect(view.x,view.y,view.width/view.zoom,view.height/view.zoom);
    ctx.fillStyle='#f7d26a';ctx.beginPath();ctx.arc(state.x,state.y,18,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#332936';ctx.lineWidth=5;ctx.stroke();ctx.restore();
  }
}
