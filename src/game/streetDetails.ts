import { DEFAULT_APPEARANCE, serializeAppearance } from '../shared/appearance';

// These props reuse occupied tree/bench anchors; the walking geometry is unchanged.
export const STREET_SERVICE_PROPS=[
  {id:'delivery-cart',x:1170,y:284,width:144,height:106},
  {id:'service-bins',x:1880,y:284,width:144,height:100},
  {id:'parked-taxi',x:2580,y:1120,width:190,height:84},
] as const;
export const STREET_RESIDENTS=[
  {id:'doorman',name:'Швейцар Аркадий',role:'У входа',x:1008,y:978,facing:'down',approach:{x:978,y:1006},
    appearance:serializeAppearance({...DEFAULT_APPEARANCE,top:4,topColor:11,bottomColor:9,shoes:1,shoeColor:9,hat:3,accessoryColor:11,facialHair:1,necklace:2}),
    lines:['Добро пожаловать в «Рояль»! Вход рядом, под короной.','Ковёр красный, но снегу это никто не объяснил.','Вокруг здания можно пройти. А за чистоту двора у нас отвечает Семён.']},
  {id:'janitor',name:'Дворник Семён',role:'Следит за двором',x:1370,y:320,facing:'down',approach:{x:1370,y:365},
    appearance:serializeAppearance({...DEFAULT_APPEARANCE,body:1,hairColor:5,top:2,topColor:3,bottomColor:10,shoes:1,shoeColor:9,hat:4,accessoryColor:10,facialHair:1,mouth:2,scarf:1}),
    lines:['Осторожнее, тут расчищено. Снег пока не в курсе.','Проход вокруг здания свободен. Я только что победил один сугроб.','Тележку поставил у стены. Посылки ждут, когда кто-нибудь перестанет быть занят.']},
  {id:'taxi-driver',name:'Таксист Гоша',role:'Ждёт у такси',x:2435,y:1142,facing:'left',approach:{x:2395,y:1138},
    appearance:serializeAppearance({...DEFAULT_APPEARANCE,skinTone:3,body:1,top:2,topColor:10,bottomColor:9,shoes:1,shoeColor:9,hat:3,accessoryColor:9,facialHair:1,scarf:1}),
    lines:['Я жду пассажира. Он сказал: «Ещё минутку». Это было до снегопада.','Жёлтая машина моя. Стою в кармане, проезду не мешаю.','В городе две новости: снег идёт, а я стою. Зато кофе ещё тёплый.']},
] as const;
export type StreetResidentId=typeof STREET_RESIDENTS[number]['id'];
export type StreetVisitor={x:number;y:number};

/** A local conversation never sends messages, takes money or changes a room. */
export class StreetConversations {
  private active=false;
  private visitor:StreetVisitor={x:0,y:0};
  private current:StreetResidentId|null=null;
  private line=0;
  update(visitor:StreetVisitor,active:boolean){
    this.visitor=visitor;this.active=active;
    const person=STREET_RESIDENTS.find(p=>p.id===this.current);
    if(!active||(person&&Math.hypot(person.x-visitor.x,person.y-visitor.y)>140))this.close();
    return this.snapshot();
  }
  talk(id:StreetResidentId){
    const person=STREET_RESIDENTS.find(p=>p.id===id);
    if(!this.active||!person||Math.hypot(person.x-this.visitor.x,person.y-this.visitor.y)>112)return false;
    this.current=id;this.line=0;return true;
  }
  next(){if(this.current){const person=STREET_RESIDENTS.find(p=>p.id===this.current)!;this.line=(this.line+1)%person.lines.length;}}
  close(){this.current=null;this.line=0;}
  snapshot(){
    const nearby=this.active?[...STREET_RESIDENTS].sort((a,b)=>Math.hypot(a.x-this.visitor.x,a.y-this.visitor.y)-Math.hypot(b.x-this.visitor.x,b.y-this.visitor.y)).find(p=>Math.hypot(p.x-this.visitor.x,p.y-this.visitor.y)<=112)?.id??null:null;
    return {active:this.active,nearby,conversation:this.current,line:this.line};
  }
}
