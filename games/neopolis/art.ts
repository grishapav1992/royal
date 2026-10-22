import type { Hero } from '../../src/shared/neopolisMath';
const wrap = (body: string, viewBox = '0 0 100 100') => '<svg viewBox="' + viewBox + '" fill="none" aria-hidden="true">' + body + '</svg>';
export function symbolArt(symbol: number): string {
  const bodies = [
    '<path d="M50 12 80 24v25c0 18-12 30-30 40-18-10-30-22-30-40V24z" fill="#3983cf" stroke="#a8dcff" stroke-width="3"/><path d="m50 28 17 10-7 20 7 12-17-8-17 8 7-12-7-20z" fill="#b5e9ff"/>',
    '<path d="M55 8 21 56h25l-5 36 39-54H54z" fill="#ffd568" stroke="#fff0b5" stroke-width="3"/>',
    '<path d="m15 30 35 12 35-12-7 38-20-7-8 12-8-12-20 7z" fill="#e86c7e" stroke="#ffc1cc" stroke-width="3"/><path d="m25 43 17 7-13 4zm50 0-17 7 13 4z" fill="#1b1c37"/>',
    '<path d="m50 12 33 19v38L50 88 17 69V31z" fill="#144a55" stroke="#73eed9" stroke-width="3"/><circle cx="50" cy="50" r="21" stroke="#6ffff0" stroke-width="6"/><circle cx="50" cy="50" r="10" fill="#d2ffed"/><path d="M50 15v12m0 46v12M20 32l11 6m38 24 11 6M20 68l11-6m38-24 11-6" stroke="#61cdbb" stroke-width="4"/>',
    '<ellipse cx="50" cy="50" rx="25" ry="36" transform="rotate(30 50 50)" fill="#321a65" stroke="#c394ff" stroke-width="5"/><ellipse cx="50" cy="50" rx="15" ry="25" transform="rotate(30 50 50)" stroke="#f4b3ff" stroke-width="3"/><path d="m17 20 3-8 3 8 8 3-8 3-3 8-3-8-8-3zm62 53 2-6 2 6 6 2-6 2-2 6-2-6-6-2z" fill="#f0bdff"/>',
    '<path d="m35 12 30 0 21 30-36 49L14 42z" fill="#277b91" stroke="#acf9ff" stroke-width="3"/><path d="m35 12 15 30L65 12M14 42h72M50 42v49" stroke="#a1efff" stroke-width="3"/><path d="m50 42 15-30 21 30z" fill="#b9f7ff"/><path d="m14 42 21-30 15 30z" fill="#68cbe4"/>',
    '<path d="m50 5 12 22 24-6-5 25 17 14-25 9-3 25-20-14-20 14-3-25-25-9 17-14-5-25 24 6z" fill="#ffce5b" stroke="#fff5ba" stroke-width="3"/><path d="m23 40 9 27 17-15 16 15 10-27" stroke="#5a320e" stroke-width="7"/>',
    '<path d="m50 7 34 20-5 43-29 23-29-23-5-43z" fill="#25152d" stroke="#fa7f94" stroke-width="3"/><path d="m29 38 17 8-6 10-12-6zm42 0-17 8 6 10 12-6z" fill="#ff698c"/><path d="m36 70 14-7 14 7M50 17v13" stroke="#ffb6cc" stroke-width="4"/>',
  ];
  return wrap(bodies[symbol] ?? bodies[0]);
}
export function portrait(hero: Hero | 'null'): string {
  const color = { granite: '#ef9c5d', impulse: '#67dfff', prism: '#c49bff', null: '#f37e9b' }[hero];
  const cape = hero === 'prism' ? '<path d="M52 82 8 187h144L108 82z" fill="#503068"/>' : hero === 'null' ? '<path d="m47 70-30 28-17 89h160l-17-89-30-28z" fill="#341e36"/>' : '';
  const body = hero === 'granite'
    ? '<path d="m49 79-27 13-17 58 25 10 14-31-6 58h85l-7-58 14 31 25-10-17-58-27-13z" fill="#6a443a"/><path d="m35 97 21 11 24-12 24 12 22-11-8 43-38 15-38-15z" fill="#ac7050"/><path d="m42 113 20 5 18-8 18 8 20-5M54 141l26-13 27 13" stroke="' + color + '" stroke-width="4"/>'
    : '<path d="m54 79-25 17-20 54 18 10 24-39-8 66h74l-8-66 24 39 18-10-20-54-25-17z" fill="' + (hero === 'null' ? '#251e30' : hero === 'prism' ? '#4e3c78' : '#204d69') + '"/><path d="m54 91 26 22 26-22-9 49H63z" fill="' + color + '" opacity=".65"/>';
  const head = hero === 'null'
    ? '<path d="m57 22 23-12 23 12 5 36-28 28-28-28z" fill="#322a40" stroke="#a85a7e" stroke-width="2"/><path d="m59 43 16 6-9 8zm42 0-16 6 9 8z" fill="#ff8aaf"/><path d="m68 69 12-6 12 6" stroke="#b86484" stroke-width="3"/>'
    : '<path d="M57 34q0-25 23-25t23 25l-4 28-19 15-19-15z" fill="#bd8c79"/><path d="M56 34V22Q65 1 87 8l18 12-2 18-13-13-33 9z" fill="' + (hero === 'granite' ? '#423938' : hero === 'prism' ? '#292343' : '#172e43') + '"/><path d="m58 37 22 5 22-5-4 17-18-5-18 5z" fill="' + color + '"/><path d="m65 43 8 3m14 0 8-3" stroke="#efffff" stroke-width="3"/>';
  return wrap(cape + body + head, '0 0 160 190');
}
export const skyline = '<svg class="np-skyline" viewBox="0 0 1400 500" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path d="M0 500V260h70v-75h20v-35h9v35h20v75h60V105h65v395h25V200h80v-55h25v55h60v300h35V120h90v-30h15v30h45v380h25V45h18V0h8v45h48v455h45V180h100v320h30V95h60v-30h10v30h30v405h40V220h80v280h20V140h65v-40h10v40h35v360h25V80h45v420h30V210h100v290h40V180h70v320z" fill="#0b152a"/><path d="M185 140h35m-35 25h35m-35 25h35m300-30h45m-45 30h45m-45 30h45m290-70h35m-35 30h35m-35 30h35m190-25h25m-25 25h25m-25 25h25" stroke="#22435d" stroke-width="5"/></svg>';
