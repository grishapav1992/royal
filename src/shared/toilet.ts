import type { Obstacle } from '../game/navigation';

export const OCCUPIED_TOILET_CUBICLE = 1;

/** Only the janitor's feet block movement; the coat is visual artwork. */
export const TOILET_MERCHANT = {
  x:650,y:480,approach:{x:587,y:473},interactionRadius:95,
  body:{x:638,y:470,w:24,h:18},
} as const;

/** Selected rectangular floor plan. Dimensions are shared by the server and renderer. */
export const TOILET = {
  width:800,height:620,viewTop:80,
  floor:{x:80,y:240,w:640,h:300},wallTop:120,tile:40,
  spawn:{x:205,y:330},window:{x:104,y:145,w:104,h:92},step:{x:130,y:244,w:55,h:18},
  counter:{x:235,y:248,w:174,h:44},
  cubicles:[436,528,620].map((x,i)=>({id:i,x,y:248,w:100,h:140})),
  cubicle:{w:100,h:140,wall:8,door:64,toilet:{x:33,y:18,w:34,h:58}},
  bin:{x:96,y:450,w:25,h:28},radiator:{x:89,y:345,w:18,h:64},
  bounds:{left:100,right:700,top:264,bottom:520},
} as const;

export const ROOF_TOILET = {
  body:{x:760,y:410,w:180,h:160},step:{x:820,y:575,w:60,h:24},
  entry:{x:850,y:620},arrival:{x:925,y:665},facing:'down',click:{x:850,y:485},
  left:832,right:868,top:615,bottom:626,
} as const;
export const TOILET_WINDOW = {
  entry:{x:156,y:280},arrival:TOILET.spawn,facing:'down',click:{x:156,y:190},
  left:140,right:172,top:278,bottom:286,
} as const;

/** Ordinary doorway to the card salon, separate from the roof window. */
export const TOILET_HALL_DOOR = {
  entry:{x:400,y:514},arrival:{x:400,y:468},facing:'up',click:{x:400,y:531},
  left:362,right:438,top:506,bottom:524,
} as const;
export const CARD_TOILET_DOOR = {
  entry:{x:230,y:240},arrival:{x:230,y:320},facing:'down',click:{x:230,y:107},
  left:192,right:268,top:225,bottom:247,
} as const;

/** Doors swing automatically on approach; their open leaves stay along the partition. */
export const TOILET_OBSTACLES:Obstacle[]=[
  {x:0,y:0,w:5000,h:244},{x:0,y:0,w:84,h:1300},
  {x:716,y:0,w:5000,h:1300},{x:0,y:536,w:5000,h:1300},
  TOILET.step,TOILET.counter,TOILET.bin,TOILET.radiator,
  TOILET_MERCHANT.body,
  ...TOILET.cubicles.flatMap(p=>[
    {x:p.x,y:p.y,w:p.w,h:8},{x:p.x,y:p.y,w:8,h:p.h},{x:p.x+p.w-8,y:p.y,w:8,h:p.h},
    {x:p.x,y:p.y+p.h-8,w:18,h:8},{x:p.x+p.w-18,y:p.y+p.h-8,w:18,h:8},
    {x:p.x+9,y:p.y+p.h-68,w:4,h:64},
    {x:p.x+33,y:p.y+18,w:34,h:58},
  ]),
  ...TOILET.cubicles.filter(p=>p.id===OCCUPIED_TOILET_CUBICLE).map(p=>({x:p.x+8,y:p.y+8,w:p.w-16,h:p.h-8})),
];

export const toiletSinkApproaches=[0,1].map(i=>({x:TOILET.counter.x+TOILET.counter.w*(i+.5)/2,y:334}));
export const toiletCubicleApproaches=TOILET.cubicles.map(p=>({x:p.x+p.w/2,y:p.y+p.h+42}));
export const toiletCubicleStanding=TOILET.cubicles.filter(p=>p.id!==OCCUPIED_TOILET_CUBICLE).map(p=>({id:p.id,x:p.x+p.w/2,y:p.y+p.h-24}));

export function toiletCubicleOpen(id:number,people:readonly {x:number;y:number}[]){
  const p=TOILET.cubicles.find(p=>p.id===id);
  return !!p&&id!==OCCUPIED_TOILET_CUBICLE&&people.some(person=>
    Math.hypot(person.x-p.x-50,person.y-p.y-140)<82||person.x>p.x&&person.x<p.x+p.w&&person.y>p.y&&person.y<p.y+p.h);
}
