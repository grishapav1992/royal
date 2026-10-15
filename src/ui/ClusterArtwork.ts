export type ClusterGame = 'studio-lumen-grove'|'studio-prism-atelier';
export const CLUSTER_SYMBOL_NAMES:Record<ClusterGame,string[]>={
  'studio-lumen-grove':['Капля росы','Янтарный лист','Ночной цветок','Дикий знак','Фонарь-сборщик','Светящееся семя'],
  'studio-prism-atelier':['Лазурная грань','Малиновая призма','Бирюзовый ромб','Дикий знак','Бонусный портал','Стеклянная медаль'],
};

/** Original SVG symbols; numeric identities come from the saved native game. */
export function clusterSymbol(game:ClusterGame,symbol:number):string {
  const forest=[
    '<path d="M48 8C36 28 20 39 20 57a28 28 0 0 0 56 0C76 39 60 28 48 8Z" fill="#25b8d7"/><path d="M48 13C43 35 26 43 26 58a22 22 0 0 0 22 22V13Z" fill="#79f0e8"/><path d="M38 40c-8 9-10 18-6 25" fill="none" stroke="#effffe" stroke-width="4"/><circle cx="61" cy="60" r="5" fill="#bcffff"/>',
    '<path d="M16 74C6 32 37 12 81 12c-2 40-15 74-50 67Z" fill="#e2a83c"/><path d="M19 70C25 40 53 28 76 17L31 80Z" fill="#ffda77"/><path d="M19 79 74 21M31 66l-3-24m20 8 21-4M47 50l-2-23m-11 37 30-5" fill="none" stroke="#946221" stroke-width="2"/>',
    '<g fill="#a465ef"><ellipse cx="48" cy="24" rx="15" ry="20"/><ellipse cx="68" cy="43" rx="20" ry="15" transform="rotate(-20 68 43)"/><ellipse cx="61" cy="65" rx="15" ry="20" transform="rotate(-35 61 65)"/><ellipse cx="35" cy="65" rx="15" ry="20" transform="rotate(35 35 65)"/><ellipse cx="27" cy="43" rx="20" ry="15" transform="rotate(20 27 43)"/></g><circle cx="48" cy="45" r="16" fill="#e4b2ff"/><circle cx="48" cy="45" r="9" fill="#ffdf72"/><circle cx="45" cy="41" r="3" fill="#ffffdd"/>',
    '<path d="m48 9 10 24 27 6-21 17 3 29-19-14-23 14 5-29L8 39l29-6Z" fill="#fff2a5"/>',
    '<path d="M33 19V9h30v10M29 29h38l6 45H23Z" fill="#39583c" stroke="#f1d477" stroke-width="3"/><path d="M29 29c0-17 38-17 38 0M26 77h44" fill="none" stroke="#ecd27a" stroke-width="5"/><path d="M33 33h30l4 34H29Z" fill="#5aeeab"/><path d="M40 33v34m17-34v34" stroke="#aaffdc"/><ellipse cx="48" cy="48" rx="8" ry="12" fill="#f8ffa0"/><circle cx="45" cy="44" r="3" fill="#fff"/>',
    '<ellipse cx="48" cy="46" rx="23" ry="30" transform="rotate(27 48 46)" fill="#b4a335"/><ellipse cx="48" cy="44" rx="18" ry="25" transform="rotate(27 48 44)" fill="#e9f481"/><path d="M37 60c2-18 9-29 20-33" fill="none" stroke="#5f882c" stroke-width="4"/><circle cx="38" cy="35" r="4" fill="#ffffd5"/>',
  ];
  const prism=[
    '<path d="m48 7 30 27-12 42H30L17 34Z" fill="#268aca"/><path d="m48 7 2 31L17 34Z" fill="#9ceeff"/><path d="m48 7 30 27-28 4Z" fill="#59cffa"/><path d="m50 38 16 38H30Z" fill="#367be5"/><path d="m17 34 33 4-20 38Z" fill="#57b6ed"/><path d="m50 38 28-4-12 42Z" fill="#24579c"/>',
    '<path d="m28 15 33-7 17 48-25 25-36-11Z" fill="#a837a1"/><path d="m28 15 25 33-36 22Z" fill="#fa91d2"/><path d="m28 15 33-7-8 40Z" fill="#ffb0ee"/><path d="m61 8 17 48-25-8Z" fill="#e85bb5"/><path d="m53 48 25 8-25 25Z" fill="#862b94"/><path d="m17 70 36-22v33Z" fill="#c657c9"/>',
    '<path d="m48 8 34 37-34 38-34-38Z" fill="#129b99"/><path d="m48 8 2 37H14Z" fill="#82f2d1"/><path d="m48 8 34 37H50Z" fill="#2dd9cd"/><path d="m50 45 32 0-34 38Z" fill="#087983"/><path d="m14 45 36 0-2 38Z" fill="#47cabc"/>',
    '<path d="m48 9 10 24 27 6-21 17 3 29-19-14-23 14 5-29L8 39l29-6Z" fill="#fff2a5"/>',
    '<path d="M22 76V26L48 9l26 17v50Z" fill="#6544b2"/><path d="M30 72V30l18-12 18 12v42Z" fill="#8fe3ff"/><path d="M36 70V35l12-8 12 8v35Z" fill="#242651"/><path d="M21 78h54" stroke="#ffde99" stroke-width="6"/><path d="m47 35 5 10 10 3-8 7 2 12-10-6-10 6 2-12-8-7 12-3Z" fill="#e9bfff"/>',
    '<circle cx="48" cy="44" r="29" fill="#7387b2"/><circle cx="48" cy="41" r="25" fill="#b7cfec"/><circle cx="48" cy="41" r="19" fill="#889fcf"/><path d="m48 22 15 19-15 19-15-19Z" fill="#daeafe"/><path d="m48 22 0 38-15-19Z" fill="#f5ffff"/>',
  ];
  return `<svg class="cluster-symbol symbol-${symbol}" viewBox="0 0 96 88" aria-hidden="true"><g stroke="${game==='studio-lumen-grove'?'#d6ffda':'#dbe8ff'}" stroke-width=".7" stroke-linecap="round" stroke-linejoin="round">${(game==='studio-lumen-grove'?forest:prism)[symbol]??forest[0]}</g></svg>`;
}
