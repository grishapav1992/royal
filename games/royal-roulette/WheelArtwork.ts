import {BALL_RADIUS,POCKET_DIVIDER} from './SpinTimeline';

/** Presentation geometry only. The host still settles the existing server rules. */
export function rouletteWheelSvg(numbers: readonly number[], color: (n: number) => string) {
  const step = 360 / numbers.length;
  const point = (a: number, r: number) => `${200 + Math.sin(a * Math.PI / 180) * r},${200 - Math.cos(a * Math.PI / 180) * r}`;
  const sectors = numbers.map((n, i) => {
    const a = i * step - step / 2, b = i * step + step / 2;
    const tip=point(a,POCKET_DIVIDER.tipRadius);
    return `
      <path d="M${point(a,176)} A176,176 0 0,1 ${point(b,176)} L${point(b,132)} A132,132 0 0,0 ${point(a,132)} Z" class="rr-sector rr-${color(n)}"/>
      <path d="M${tip} L${point(a,133)}" stroke="#f5d698" stroke-opacity=".76" stroke-width="${POCKET_DIVIDER.width}"/>
      <circle r="${POCKET_DIVIDER.capRadius}" transform="translate(${tip})" fill="url(#rr-fastener)"/>
      <text x="200" y="42" transform="rotate(${i*step} 200 200)">${n}</text>`;
  }).join('');
  const grooves = Array.from({length:24},(_,i)=>{
    const angle=i*15;
    return `<path d="M${point(angle,83)} L${point(angle,116)} L${point(angle+1.5,114)} L${point(angle+1,85)} Z" fill="#0b0906" fill-opacity=".48" stroke="#d3a566" stroke-opacity=".24" stroke-width=".5"/>`;
  }).join('');
  const rivets = Array.from({length:24},(_,i)=>`<circle r="1.45" transform="translate(${point(i*15+7.5,193)})" fill="url(#rr-fastener)"/>`).join('');
  const pocketShades = [
    ['red','#421d21','#a93944','#7b242e'],
    ['black','#080f0c','#273c32','#14221d'],
    ['green','#12382a','#3b825b','#20593d'],
  ].map(([name,inner,number,outer])=>`
    <radialGradient id="rr-pocket-${name}" gradientUnits="userSpaceOnUse" cx="200" cy="200" r="176">
      <stop offset=".75" stop-color="${inner}"/><stop offset=".91" stop-color="${number}"/><stop offset="1" stop-color="${outer}"/>
    </radialGradient>`).join('');
  return `<svg class="rr-wheel-svg" viewBox="0 0 400 400" aria-hidden="true">
    <defs>
      <linearGradient id="rr-gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#64401d"/><stop offset=".16" stop-color="#fff0b9"/><stop offset=".34" stop-color="#c99c54"/><stop offset=".52" stop-color="#ffe6a1"/><stop offset=".7" stop-color="#997036"/><stop offset=".87" stop-color="#efcf8c"/><stop offset="1" stop-color="#70471f"/></linearGradient>
      <radialGradient id="rr-wood"><stop stop-color="#301811"/><stop offset=".64" stop-color="#75412a"/><stop offset=".79" stop-color="#321b13"/><stop offset=".85" stop-color="#60341f"/><stop offset=".9" stop-color="#9b5e36"/><stop offset=".94" stop-color="#4b2618"/><stop offset=".98" stop-color="#794a30"/><stop offset="1" stop-color="#27150f"/></radialGradient>
      <radialGradient id="rr-bowl"><stop stop-color="#1f130d"/><stop offset=".6" stop-color="#352219"/><stop offset=".73" stop-color="#69402a"/><stop offset=".91" stop-color="#33241a"/><stop offset=".97" stop-color="#151712"/><stop offset="1" stop-color="#8e6840"/></radialGradient>
      <radialGradient id="rr-pearl" cx=".32" cy=".24" r=".79"><stop stop-color="#fffef9"/><stop offset=".22" stop-color="#fff8e0"/><stop offset=".54" stop-color="#e9dcc1"/><stop offset=".79" stop-color="#afa28a"/><stop offset=".94" stop-color="#ded1ac"/><stop offset="1" stop-color="#6f6655"/></radialGradient>
      <radialGradient id="rr-fastener" cx=".31" cy=".25" r=".77"><stop stop-color="#fff2c0"/><stop offset=".48" stop-color="#d2a969"/><stop offset="1" stop-color="#795030"/></radialGradient>
      <radialGradient id="rr-hub"><stop stop-color="#fff3bf"/><stop offset=".45" stop-color="#ba8c45"/><stop offset=".75" stop-color="#5d401e"/><stop offset="1" stop-color="#eed69b"/></radialGradient>
      ${pocketShades}
      <filter id="rr-hub-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-opacity=".65"/></filter>
    </defs>
    <circle cx="200" cy="200" r="198" fill="#100e0a"/>
    <circle cx="200" cy="200" r="195" fill="url(#rr-wood)" stroke="url(#rr-gold)" stroke-width="4"/>
    <circle cx="200" cy="200" r="191.5" fill="none" stroke="#d8a668" stroke-opacity=".66" stroke-width=".8"/>
    ${rivets}
    <circle cx="200" cy="200" r="187" fill="none" stroke="#241712" stroke-width="6"/>
    <circle cx="200" cy="200" r="188.8" fill="none" stroke="#d6a268" stroke-opacity=".55" stroke-width=".7"/>
    <circle cx="200" cy="200" r="182" fill="#161b16" stroke="url(#rr-gold)" stroke-width="3.2"/>
    <circle cx="200" cy="200" r="179.4" fill="none" stroke="#805635" stroke-width="1.1"/>
    <g class="rr-rotor">
      ${sectors}
      <circle cx="200" cy="200" r="177" fill="none" stroke="#ecd295" stroke-width="1.4"/>
      <circle cx="200" cy="200" r="131" fill="url(#rr-bowl)" stroke="url(#rr-gold)" stroke-width="2.4"/>
      <circle cx="200" cy="200" r="126" fill="none" stroke="#100e0a" stroke-width="2"/>
      <circle cx="200" cy="200" r="123.5" fill="none" stroke="#deb97d" stroke-opacity=".5"/>
      <circle cx="200" cy="200" r="118" fill="none" stroke="#b0804b" stroke-opacity=".4"/>
      ${grooves}
      <circle cx="200" cy="200" r="80" fill="url(#rr-wood)" stroke="#a4783f" stroke-opacity=".65"/>
      <circle cx="200" cy="200" r="75" fill="none" stroke="#d4ac69" stroke-opacity=".38"/>
      <circle cx="200" cy="200" r="69" fill="none" stroke="#e4b975" stroke-opacity=".26" stroke-dasharray="2 3"/>
    </g>
    <g class="rr-spindle" filter="url(#rr-hub-shadow)">
      ${[45,135,225,315].map(a=>`<g transform="rotate(${a} 200 200)"><path d="M195 198 L192.5 144 Q200 129 207.5 144 L205 198 Z" fill="url(#rr-gold)" stroke="#ae8b50" stroke-width=".8"/><path d="M200 143 L200 177" stroke="#62441f" stroke-opacity=".7" stroke-width="2.6" stroke-linecap="round"/><path d="M198.6 144 L198.6 176" stroke="#fff0b0" stroke-opacity=".58" stroke-width=".6" stroke-linecap="round"/></g>`).join('')}
      <circle cx="200" cy="200" r="25" fill="url(#rr-hub)" stroke="#eacb87" stroke-width="1.5"/>
      <circle cx="200" cy="200" r="17" fill="url(#rr-gold)" stroke="#7b552b"/>
      <circle cx="200" cy="200" r="12" fill="url(#rr-hub)" stroke="#ffe2a4" stroke-opacity=".66" stroke-width=".7"/>
      <circle cx="200" cy="200" r="7" fill="url(#rr-pearl)"/>
    </g>
    <g class="rr-ball-trails"><circle r="2.7" fill="#fff1cd" opacity="0"/><circle r="2" fill="#fff1cd" opacity="0"/><circle r="1.2" fill="#fff1cd" opacity="0"/></g>
    <g class="rr-ball-orbit"><g class="rr-ball-carrier">
      <circle class="rr-ball-shadow" cx="201" cy="54" r="5.8" fill="#000" opacity=".46"/>
      <circle class="rr-ball" cx="200" cy="52" r="${BALL_RADIUS}" fill="url(#rr-pearl)"/>
    </g></g>
    <path d="M187 14 Q200 6 213 14 L200 33 Z" fill="url(#rr-gold)" stroke="#fff1be" stroke-width=".8"/>
    <path d="M191 15 Q200 10 209 15 L200 28 Z" fill="none" stroke="#73502b" stroke-opacity=".8" stroke-width=".8"/>
  </svg>`;
}
