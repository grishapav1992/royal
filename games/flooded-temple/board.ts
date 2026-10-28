import {templeEdgeKey,templeLegalActions,type TempleMap} from '../../src/shared/floodedTempleMath';
import type {TempleView} from '../../src/shared/floodedTemple';
import {art,prop,escape,roomName} from './art';
import type {TempleBeat} from './presentation';

export function roomDescription(map:TempleMap,room:number,en:boolean){
  if(room===map.entry)return en?'Entrance':'Вход';
  if(map.levers[room])return (en?'Lever opens gate ':'Рычаг открывает ворота ')+map.levers[room].split(':').map(Number).map(roomName).join(' ↔ ');
  if(map.relics.includes(room))return en?'Relic opens a six-move expedition':'Реликвия открывает экспедицию на шесть ходов';
  if(map.treasures[room])return (en?'Treasure ':'Сокровище ')+(map.treasures[room]/100).toLocaleString(en?'en-US':'ru-RU',{maximumFractionDigits:2})+'×';
  return en?'Empty room':'Пустая комната';
}
export function boardMarkup(view:TempleView|undefined,bonus:boolean,selected:number|null,armed:boolean,disabled:boolean,en:boolean,beat?:TempleBeat){
  const map=bonus?view?.bonusMap:view?.baseMap;
  const state=bonus?view?.bonusState:null;
  const visited=new Set(beat?.frame.visited??(bonus?state?.visited:view?.baseResult.visited)),opened=new Set(beat?.frame.opened??(bonus?state?.opened:view?.baseResult.opened));
  const legal=!beat&&map&&state&&!state.done?templeLegalActions(map,state):[];
  const at=beat?.frame.at??(bonus?state?.at:view?.baseResult.events.at(-1)?.room);
  const route=beat?.frame.route??(bonus?[5,...(view?.history??[]).flatMap(a=>'to'in a?[a.to]:[])]:view?.baseResult.events.flatMap(e=>e.path)??[]);
  const wall=(x1:number,y1:number,x2:number,y2:number)=>{const d=`M${x1} ${y1}L${x2} ${y2}`;return `<path d="${d}" class="ft-wall-shadow"/><path d="${d}" class="ft-wall"/><path d="${d}" class="ft-wall-engraving"/>`;};
  let walls='';
  if(map)for(let room=0;room<20;room++)for(const next of[room%5<4?room+1:-1,room<15?room+5:-1]){
    if(next<0)continue;
    const vertical=next===room+1,x=vertical?(room%5+1)*100:room%5*100,y=vertical?Math.floor(room/5)*100:(Math.floor(room/5)+1)*100;
    const line=(from:number,to:number)=>vertical?wall(x,y+from,x,y+to):wall(x+from,y,x+to,y);
    const edge=map.edges.find(e=>templeEdgeKey(e.a,e.b)===templeEdgeKey(room,next));
    if(!edge){walls+=line(0,100);continue;}
    walls+=line(0,31)+line(69,100);
    const cx=vertical?x:x+50,cy=vertical?y+50:y,angle=vertical?0:90,key=templeEdgeKey(room,next);
    const bridge=(beat?beat.frame.bridge:state?.bridge)===key,unlocked=opened.has(key);
    if(edge.kind==='gate'&&(!unlocked||beat?.kind==='gate'&&beat.edge===key))walls+=`<g class="ft-gate" data-edge="${key}" transform="translate(${cx} ${cy}) rotate(${angle})"><g class="ft-gate-body"><rect x="-9" y="-21" width="18" height="42" rx="2" fill="#24261e" stroke="#ba9558" stroke-width="2"/><path d="M-5 -18V18M0 -18V18M5 -18V18M-8 -11H8M-8 11H8" stroke="#d6b979" stroke-width="2"/><path d="M-7 -20H7" stroke="#fff0b1"/><image href="/assets/flooded-temple/props/gate.webp" x="-19" y="-25" width="38" height="50"/></g></g>`;
    else if(edge.kind==='gap')walls+=`<g transform="translate(${cx} ${cy}) rotate(${angle})"><path d="M-15 -19L-9 -10L-15 0L-9 10L-15 19H15L9 10L15 0L9 -10L15 -19Z" fill="#010e18" stroke="#567879" stroke-width="2"/>${bridge?'<path class="ft-bridge" d="M-20 -11H20M-20 11H20M-13 -11V11M-5 -11V11M3 -11V11M11 -11V11" stroke="#deb56c" stroke-width="2"/>':''}</g>`;
    else walls+=`<circle cx="${cx}" cy="${cy}" r="3" fill="${unlocked?'#efc77e':'#4bb6b3'}"/>`;
  }
  const segments=route.flatMap((room,i)=>i&&room!==route[i-1]?`M${route[i-1]%5*100+50} ${Math.floor(route[i-1]/5)*100+50}L${room%5*100+50} ${Math.floor(room/5)*100+50}`:[]).join(' ');
  const arrows=route.flatMap((room,i)=>{if(!i||room===route[i-1])return [];const from=route[i-1],x=(from%5+room%5)*50+50,y=(Math.floor(from/5)+Math.floor(room/5))*50+50,angle=room===from+1?0:room===from-1?180:room>from?90:-90;return `<path class="ft-route-arrow" d="M-6 -5L1 0L-6 5" transform="translate(${x} ${y}) rotate(${angle})"/>`;}).join('');
  return `<div class="ft-map" ${!map?'data-unopened="true"':''}>
    <div class="ft-rooms" role="group" aria-label="${en?'Temple rooms':'Комнаты храма'}">${Array.from({length:20},(_,room)=>{
      const action=legal.find(a=>'to'in a&&a.to===room),collected=visited.has(room),current=at===room;
      const description=map?roomDescription(map,room,en):en?'Unexplored temple':'Храм ещё не открыт';
      const type=!map?'':map.levers[room]?'lever':map.relics.includes(room)?'relic':map.treasures[room]?'chest':room===5?'compass':'';
      const symbol=type==='chest'?prop('chest','ft-prop-closed')+prop('chest-open','ft-prop-open'):type==='lever'?prop('lever','ft-prop-upright')+prop('lever-pulled','ft-prop-pulled'):type?prop(type):'';
      const open=type==='chest'?collected&&beat?.kind!=='collect':type==='lever'?opened.has(map!.levers[room])&&beat?.kind!=='lever':false;
      const amount=map?.treasures[room];
      const surface=room===(map?.entry??5)?2:[0,1,3][(room*7+Math.floor(room/5))%3];
      return `<button type="button" data-room="${room}" data-surface="${surface}" data-revealed="${!beat||Math.floor(room/5)<beat.frame.revealed}" class="ft-room ${collected?'visited':''} ${current?'current':''} ${action?'reachable':''} ${action?.kind==='rope'?'needs-rope':''}" ${disabled||!map?'disabled':''} aria-pressed="${selected===room}" aria-label="${escape(`${roomName(room)}. ${description}. ${collected?(en?'Visited. ':'Посещено. '):''}${current?(en?'You are here. ':'Вы здесь. '):''}${action?(action.kind==='rope'?(en?'Rope crossing. ':'Переход с верёвкой. '):(en?'Available move. ':'Доступный ход. ')):''}`)}"><span class="ft-room-id">${roomName(room)}</span><span class="ft-room-art" data-prop="${type}" data-open="${open}">${symbol}</span>${amount?`<span class="ft-mult">${(amount/100).toLocaleString(en?'en-US':'ru-RU',{maximumFractionDigits:2})}×</span>`:''}${collected?`<span class="ft-collected">${art.check}</span>`:''}${current?`<span class="ft-position" aria-hidden="true">${art.explorer}</span>`:''}${action?.kind==='rope'?`<span class="ft-rope-mark ${armed?'armed':''}">${art.rope}</span>`:''}</button>`;
    }).join('')}</div>
    <svg class="ft-map-lines" viewBox="0 0 500 400" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="ft-stone-wall" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="500" y2="400"><stop stop-color="#a39469"/><stop offset=".18" stop-color="#5c7873"/><stop offset=".48" stop-color="#254953"/><stop offset=".72" stop-color="#46676a"/><stop offset="1" stop-color="#9b8e61"/></linearGradient></defs><path d="${segments}" class="ft-trail-shadow"/><path d="${segments}" class="ft-trail"/>${walls}${arrows}</svg>
    ${!map?`<div class="ft-sealed"><span>${art.compass}</span><strong>${en?'THE TEMPLE AWAITS':'ХРАМ ЖДЁТ ТЕБЯ'}</strong><p>${en?'Open the ruins. Follow the passages.<br>Find the relic to choose your own path.':'Открой руины. Пройди по коридорам.<br>Найди реликвию и выбери свой путь.'}</p></div>`:''}
  </div>`;
}
