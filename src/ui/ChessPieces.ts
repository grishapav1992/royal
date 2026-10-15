const shapes:Record<string,string>={
  p:'<circle cx="32" cy="20" r="10"/><path d="M25 31h14l-3 8c0 9 3 15 9 21H19c6-6 9-12 9-21z"/>',
  r:'<path d="M16 12h9v8h7v-8h7v8h9v-8h4v17l-9 7 3 23H18l3-23-9-7V12z"/><path d="M19 30h26M23 38h18" fill="none"/>',
  n:'<path d="M18 60c0-13 6-22 18-28l-12 4-8-5 5-11 12-8 8-7 2 12c10 7 13 19 10 30l-7 13z"/><path d="M35 15c9 6 12 16 10 25M20 28l9-3M31 43c-5 4-7 8-8 13" fill="none"/><circle cx="34" cy="23" r="1.9" fill="currentColor" stroke="none"/>',
  b:'<path d="M32 7c7 8 14 14 14 22 0 7-7 12-14 12s-14-5-14-12c0-8 7-14 14-22z"/><path d="M26 39h12l-1 7 8 14H19l8-14z"/><path d="m29 18 8 12" fill="none" stroke="currentColor"/>',
  q:'<path d="m14 20 8 8 2-15 8 12 8-12 2 15 8-8-7 23H21z"/><circle cx="14" cy="17" r="3"/><circle cx="24" cy="10" r="3"/><circle cx="40" cy="10" r="3"/><circle cx="50" cy="17" r="3"/><path d="M24 44h16l-3 5 9 11H18l9-11z"/><path d="M23 35h18" fill="none"/>',
  k:'<path d="M29 5h6v7h7v6h-7v9h-6v-9h-7v-6h7z"/><path d="M17 29c3-6 10-8 15-3 5-5 12-3 15 3 4 7-1 12-8 14H25c-7-2-12-7-8-14z"/><path d="M25 43h14l-2 7 8 10H19l8-10z"/><path d="M24 36h16" fill="none"/>',
};

/** Original Staunton silhouettes remain sharp at every screen density. */
export function chessPiece(type:string,color:'w'|'b',instance:string){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 64 80');svg.setAttribute('aria-hidden','true');svg.classList.add('chess-piece');
  const id='piece-'+instance+'-'+color,light=color==='w';
  svg.style.color=light?'#655442':'#b7c2c2';
  svg.innerHTML=`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2=".6"><stop stop-color="${light?'#fffdf2':'#687a80'}"/><stop offset=".38" stop-color="${light?'#eee4cb':'#35484d'}"/><stop offset=".72" stop-color="${light?'#d6c5a0':'#19292f'}"/><stop offset="1" stop-color="${light?'#aa916e':'#0b161e'}"/></linearGradient></defs><ellipse cx="33" cy="73" rx="24" ry="4" fill="#071a20" opacity=".22"/><g fill="url(#${id})" stroke="${light?'#756146':'#12212a'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shapes[type]||shapes.p}<path d="M18 59h28l3 5H15z"/><path d="M15 65h34l4 6H11z"/><path d="M18 63h28M15 69h33" fill="none" stroke="${light?'#fffae5':'#849494'}" stroke-width="1" opacity=".65"/></g>`;
  return svg;
}
