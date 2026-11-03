import { DEFAULT_APPEARANCE, serializeAppearance } from '../shared/appearance';

// These props reuse occupied tree/bench anchors; the walking geometry is unchanged.
export const STREET_SERVICE_PROPS=[
  {id:'delivery-cart',x:1170,y:284,width:144,height:106},
  {id:'service-bins',x:1880,y:284,width:144,height:100},
  {id:'parked-taxi',x:2580,y:1120,width:190,height:84},
] as const;
export const STREET_RESIDENTS=[
  {id:'doorman',name:'Швейцар Аркадий',role:'У входа',x:1008,y:978,facing:'down',approach:{x:948,y:1006},
    appearance:serializeAppearance({...DEFAULT_APPEARANCE,top:4,topColor:11,bottomColor:9,shoes:1,shoeColor:9,hat:3,accessoryColor:11,facialHair:1,necklace:2}),
    lines:['Добро пожаловать в «Рояль»! Вход рядом, под короной.','Ковёр красный, но снегу это никто не объяснил.','Вокруг здания можно пройти. А за чистоту двора у нас отвечает Семён.']},
  {id:'janitor',name:'Дворник Семён',role:'Следит за двором',x:1370,y:320,facing:'down',approach:{x:1308,y:365},
    appearance:serializeAppearance({...DEFAULT_APPEARANCE,body:1,hairColor:5,top:2,topColor:3,bottomColor:10,shoes:1,shoeColor:9,hat:4,accessoryColor:10,facialHair:1,mouth:2,scarf:1}),
    lines:['Осторожнее, тут расчищено. Снег пока не в курсе.','Проход вокруг здания свободен. Я только что победил один сугроб.','Тележку поставил у стены. Посылки ждут, когда кто-нибудь перестанет быть занят.']},
  {id:'taxi-driver',name:'Таксист Гоша',role:'Ждёт у такси',x:2435,y:1142,facing:'left',approach:{x:2360,y:1150},
    appearance:serializeAppearance({...DEFAULT_APPEARANCE,skinTone:3,body:1,top:2,topColor:10,bottomColor:9,shoes:1,shoeColor:9,hat:3,accessoryColor:9,facialHair:1,scarf:1}),
    lines:['Я жду пассажира. Он сказал: «Ещё минутку». Это было до снегопада.','Жёлтая машина моя. Стою в кармане, проезду не мешаю.','В городе две новости: снег идёт, а я стою. Зато кофе ещё тёплый.','Кофе, перекур, взгляд на часы. Мой пассажир решил проверить весь распорядок.']},
  {id:'tourist',name:'Турист Лёня',role:'Ищет удачный ракурс',x:1420,y:1006,facing:'up',approach:{x:1342,y:1048},
    appearance:serializeAppearance({...DEFAULT_APPEARANCE,top:2,topColor:1,bottomColor:5,hat:2,accessoryColor:4,hairColor:3,scarf:1,shoes:1,shoeColor:10}),
    lines:['Корону в кадр поймал. Теперь надо, чтобы фонарь не вырос у меня из головы.','Я снимаю архитектуру. Голубь почему-то уверен, что снимаю его.','Золотик уже позировал. Теперь спрашивает, с какой стороны фишка стройнее.']},
  {id:'mascot',name:'Талисман Золотик',role:'Золотая фишка',x:1130,y:1000,facing:'down',approach:{x:1046,y:1049},
    appearance:serializeAppearance({...DEFAULT_APPEARANCE,top:1,topColor:2,bottomColor:9,shoeColor:9,mouth:1,hat:0}),
    lines:['Я Золотик. Фишка большая, карманы маленькие.','Для фото у меня три позы. Четвёртая называется «перерыв».','Под костюмом жарко. Снаружи зима. Почти идеальный климат.']},
] as const;
export type StreetResidentId=typeof STREET_RESIDENTS[number]['id'];
export type StreetVisitor={x:number;y:number;stairStep?:number};
export type StreetResidentPosition=StreetVisitor&{id:StreetResidentId};
export const canTalkToStreetResidents=(visitor:StreetVisitor)=>(visitor.stairStep??0)===0;

// Frame the rear service area as the player walks around either corner.
export function streetViewOffset(y:number,viewHeight:number){
  const front=Math.min(140,Math.max(0,viewHeight/2-270));
  const rear=-Math.min(95,Math.max(0,viewHeight/2-220));
  const blend=Math.min(1,Math.max(0,(700-y)/240));
  return front+(rear-front)*blend;
}

/** A local conversation never sends messages, takes money or changes a room. */
export class StreetConversations {
  private active=false;
  private visitor:StreetVisitor={x:0,y:0};
  private current:StreetResidentId|null=null;
  private line=0;
  private people:readonly StreetResidentPosition[]=STREET_RESIDENTS;
  update(visitor:StreetVisitor,active:boolean,people:readonly StreetResidentPosition[]=STREET_RESIDENTS){
    this.visitor=visitor;this.active=active&&canTalkToStreetResidents(visitor);this.people=people;
    const person=this.people.find(p=>p.id===this.current);
    if(!this.active||(person&&Math.hypot(person.x-visitor.x,person.y-visitor.y)>140))this.close();
    return this.snapshot();
  }
  talk(id:StreetResidentId){
    const person=this.people.find(p=>p.id===id);
    if(!this.active||!person||Math.hypot(person.x-this.visitor.x,person.y-this.visitor.y)>112)return false;
    this.current=id;this.line=0;return true;
  }
  next(){if(this.current){const person=STREET_RESIDENTS.find(p=>p.id===this.current)!;this.line=(this.line+1)%person.lines.length;}}
  close(){this.current=null;this.line=0;}
  snapshot(){
    const nearby=this.active?[...this.people].sort((a,b)=>Math.hypot(a.x-this.visitor.x,a.y-this.visitor.y)-Math.hypot(b.x-this.visitor.x,b.y-this.visitor.y)).find(p=>Math.hypot(p.x-this.visitor.x,p.y-this.visitor.y)<=112)?.id??null:null;
    return {active:this.active,nearby,conversation:this.current,line:this.line};
  }
}
