/** Presentation geometry only. The host still settles the existing server rules. */
export function rouletteWheelSvg(numbers: readonly number[], color: (n: number) => string) {
  const step = 360 / numbers.length;
  const point = (a: number, r: number) => `${200 + Math.sin(a * Math.PI / 180) * r},${200 - Math.cos(a * Math.PI / 180) * r}`;
  const sectors = numbers.map((n, i) => {
    const a = i * step - step / 2, b = i * step + step / 2;
    return `<path d="M${point(a,176)} A176,176 0 0,1 ${point(b,176)} L${point(b,132)} A132,132 0 0,0 ${point(a,132)} Z" class="rr-sector rr-${color(n)}"/><path d="M${point(a,175)} L${point(a,133)}" stroke="#f5d698" stroke-opacity=".5" stroke-width=".7"/><text x="200" y="42" transform="rotate(${i*step} 200 200)">${n}</text>`;
  }).join('');
  const grooves = Array.from({length:16},(_,i)=>`<path d="M${point(i*22.5,82)} L${point(i*22.5,117)}" stroke="#dcad65" stroke-opacity=".16"/>`).join('');
  return `<svg class="rr-wheel-svg" viewBox="0 0 400 400" aria-hidden="true">
    <defs>
      <linearGradient id="rr-gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#64401d"/><stop offset=".16" stop-color="#fff0b9"/><stop offset=".34" stop-color="#c99c54"/><stop offset=".52" stop-color="#ffe6a1"/><stop offset=".7" stop-color="#997036"/><stop offset=".87" stop-color="#efcf8c"/><stop offset="1" stop-color="#70471f"/></linearGradient>
      <radialGradient id="rr-wood"><stop stop-color="#311b13"/><stop offset=".6" stop-color="#6c3b24"/><stop offset=".8" stop-color="#351a12"/><stop offset=".94" stop-color="#895233"/><stop offset="1" stop-color="#2a170f"/></radialGradient>
      <radialGradient id="rr-bowl"><stop stop-color="#6a3a22"/><stop offset=".45" stop-color="#3d251b"/><stop offset=".82" stop-color="#1b1913"/><stop offset="1" stop-color="#a47c40"/></radialGradient>
      <radialGradient id="rr-pearl" cx=".35" cy=".28"><stop stop-color="#fffef0"/><stop offset=".5" stop-color="#f1e6cb"/><stop offset="1" stop-color="#8f8878"/></radialGradient>
      <radialGradient id="rr-hub"><stop stop-color="#fff3bf"/><stop offset=".45" stop-color="#ba8c45"/><stop offset=".75" stop-color="#5d401e"/><stop offset="1" stop-color="#eed69b"/></radialGradient>
      <filter id="rr-hub-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-opacity=".65"/></filter>
    </defs>
    <circle cx="200" cy="200" r="198" fill="#100e0a"/>
    <circle cx="200" cy="200" r="195" fill="url(#rr-wood)" stroke="url(#rr-gold)" stroke-width="4"/>
    <circle cx="200" cy="200" r="188" fill="none" stroke="#b0804b" stroke-opacity=".65"/>
    <circle cx="200" cy="200" r="182" fill="#141712" stroke="url(#rr-gold)" stroke-width="5"/>
    <g class="rr-rotor">
      ${sectors}
      <circle cx="200" cy="200" r="177" fill="none" stroke="#ecd295" stroke-width="1.4"/>
      <circle cx="200" cy="200" r="131" fill="url(#rr-bowl)" stroke="url(#rr-gold)" stroke-width="3"/>
      <circle cx="200" cy="200" r="124" fill="none" stroke="#deb97d" stroke-opacity=".5"/>
      <circle cx="200" cy="200" r="118" fill="none" stroke="#130f0b" stroke-width="3"/>
      ${grooves}
      <circle cx="200" cy="200" r="80" fill="url(#rr-wood)" stroke="#a4783f" stroke-opacity=".65"/>
      <circle cx="200" cy="200" r="75" fill="none" stroke="#d4ac69" stroke-opacity=".3"/>
    </g>
    <g class="rr-spindle" filter="url(#rr-hub-shadow)">
      ${[45,135,225,315].map(a=>`<path d="M195 198 L193 143 Q200 130 207 143 L205 198 Z" fill="url(#rr-gold)" stroke="#ae8b50" stroke-width=".8" transform="rotate(${a} 200 200)"/>`).join('')}
      <circle cx="200" cy="200" r="25" fill="url(#rr-hub)" stroke="#eacb87" stroke-width="1.5"/>
      <circle cx="200" cy="200" r="17" fill="url(#rr-gold)" stroke="#7b552b"/>
      <circle cx="200" cy="200" r="7" fill="url(#rr-pearl)"/>
    </g>
    <g class="rr-ball-trails"><circle r="2.7" fill="#fff1cd" opacity="0"/><circle r="2" fill="#fff1cd" opacity="0"/><circle r="1.2" fill="#fff1cd" opacity="0"/></g>
    <g class="rr-ball-orbit"><g class="rr-ball-carrier">
      <circle class="rr-ball-shadow" cx="201" cy="54" r="5.8" fill="#000" opacity=".46"/>
      <circle class="rr-ball" cx="200" cy="52" r="5" fill="url(#rr-pearl)"/>
    </g></g>
    <path d="M187 14 Q200 6 213 14 L200 33 Z" fill="url(#rr-gold)" stroke="#fff1be" stroke-width=".8"/>
  </svg>`;
}
