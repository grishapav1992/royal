/** Free cosmetic collection. It has no access to wager entropy, stakes or settlements. */
export type StarSide='light'|'dark';
export type StarText={ru:string;en:string};
export const STAR_CHARACTERS=[
 {id:'lyra',side:'light',cost:0,name:{ru:'Лира Восс',en:'Lyra Voss'},species:{ru:'Человек · Джедай',en:'Human · Jedi'},bio:{ru:'Хранительница звёздных путей. Спокойствие и решимость Светлой стороны.',en:'Keeper of the star routes. The calm resolve of the Light side.'}},
 {id:'aeliri',side:'light',cost:100,name:{ru:'Аэлири',en:'Aeliri'},species:{ru:'Талири · Джедай',en:'Taliri · Jedi'},bio:{ru:'Мудрая исследовательница с бирюзовой кожей и чувствительными головными отростками.',en:'A wise explorer with turquoise skin and sensitive head tendrils.'}},
 {id:'vespera',side:'dark',cost:0,name:{ru:'Дарт Веспера',en:'Darth Vespera'},species:{ru:'Человек · Ситх',en:'Human · Sith'},bio:{ru:'Сереброволосая командующая Тёмной стороны. Сила воли и безупречная выдержка.',en:'Silver-haired commander of the Dark side. Willpower and composure.'}},
 {id:'nyxara',side:'dark',cost:100,name:{ru:'Дарт Никсара',en:'Darth Nyxara'},species:{ru:'Велари · Ситх',en:'Velari · Sith'},bio:{ru:'Загадочная воительница с фиолетовой кожей, чёрными рогами и золотыми глазами.',en:'A mysterious warrior with violet skin, black horns and golden eyes.'}},
] as const;
export type StarCharacterId=typeof STAR_CHARACTERS[number]['id'];
export const starCharacter=(value:unknown)=>STAR_CHARACTERS.find(c=>c.id===value);
export const isStarSide=(value:unknown):value is StarSide=>value==='light'||value==='dark';
export const starDay=(now:number)=>new Date(now+10800000).toISOString().slice(0,10);
export type StarChallenge={id:string;kind:'lesson'|'daily';reward:number;title:StarText;question:StarText;options:{id:string;text:StarText}[];completed:boolean};
export type StarCollection={version:1;accountId:string;revision:number;day:string;nextResetAt:number;tokens:number;side:StarSide|null;selected:StarCharacterId|null;selectedBySide:Record<StarSide,StarCharacterId>;owned:StarCharacterId[];challenges:StarChallenge[];receipt?:{requestId:string;reward:number;unlocked?:StarCharacterId}};
export type StarRequest={id:string;action:'side';side:StarSide}|{id:string;action:'unlock'|'select';characterId:StarCharacterId}|{id:string;action:'answer';challengeId:string;day:string;answer:string};
