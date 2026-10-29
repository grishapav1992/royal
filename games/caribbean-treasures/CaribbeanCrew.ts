export const CAPTAIN_POSES={idle:'captain',win:'captain-win',blink:'captain-blink',focus:'captain-focus',surprise:'captain-surprise',bonus:'captain-bonus',soft:'captain-soft',laugh:'captain-laugh'} as const;
export type CaptainPose=keyof typeof CAPTAIN_POSES;
export const DEFAULT_CAPTAIN='isabella';
export const CARIBBEAN_CREW=[
  {
    "id": "isabella",
    "ru": "Изабелла",
    "en": "Isabella",
    "titleRu": "Алая волна",
    "titleEn": "Scarlet Wave",
    "accent": "#c75244"
  },
  {
    "id": "amara",
    "ru": "Амара",
    "en": "Amara",
    "titleRu": "Изумрудный прилив",
    "titleEn": "Emerald Tide",
    "accent": "#2ca97b"
  },
  {
    "id": "mei",
    "ru": "Мэй",
    "en": "Mei",
    "titleRu": "Ночной парус",
    "titleEn": "Night Sail",
    "accent": "#438ed1"
  },
  {
    "id": "priya",
    "ru": "Прия",
    "en": "Priya",
    "titleRu": "Звезда муссона",
    "titleEn": "Monsoon Star",
    "accent": "#b971c9"
  },
  {
    "id": "yasmin",
    "ru": "Ясмин",
    "en": "Yasmin",
    "titleRu": "Лунный курс",
    "titleEn": "Moonlit Course",
    "accent": "#c990aa"
  },
  {
    "id": "zahara",
    "ru": "Захара",
    "en": "Zahara",
    "titleRu": "Медный шторм",
    "titleEn": "Copper Storm",
    "accent": "#cf9852"
  },
  {
    "id": "catalina",
    "ru": "Каталина",
    "en": "Catalina",
    "titleRu": "Коралловая бухта",
    "titleEn": "Coral Bay",
    "accent": "#eb8673"
  },
  {
    "id": "moana",
    "ru": "Моана",
    "en": "Moana",
    "titleRu": "Голос океана",
    "titleEn": "Ocean Voice",
    "accent": "#44c1ba"
  },
  {
    "id": "freya",
    "ru": "Фрейя",
    "en": "Freya",
    "titleRu": "Северное сияние",
    "titleEn": "Northern Light",
    "accent": "#8bb9ed"
  },
  {
    "id": "rowan",
    "ru": "Ровена",
    "en": "Rowena",
    "titleRu": "Рыжий прилив",
    "titleEn": "Crimson Tide",
    "accent": "#cf915a"
  },
  {
    "id": "ines",
    "ru": "Инес",
    "en": "Ines",
    "titleRu": "Аметистовый ветер",
    "titleEn": "Amethyst Wind",
    "accent": "#ad85ce"
  }
] as const;
export type CrewId=typeof CARIBBEAN_CREW[number]['id'];
export function crewMember(id:string){return CARIBBEAN_CREW.find(member=>member.id===id);}
export function crewPortrait(id:CrewId,pose:CaptainPose='idle'){
 return '/assets/caribbean-treasures/'+(id===DEFAULT_CAPTAIN?CAPTAIN_POSES[pose]:'crew/'+id+'-'+pose)+'.webp';
}
export function crewThumbnail(id:CrewId){return '/assets/caribbean-treasures/crew/'+id+'-thumb.webp';}
