/** Spin button artwork: a lit core inside a segmented ring. Segments show mission or autoplay progress. */
const RADIUS = 83;
const GAP = 8;
const LENGTH = 2 * Math.PI * RADIUS;
const ring = `cx="100" cy="100" r="${RADIUS}" fill="none"`;

export const reactorMarkup = () => `<svg class="cx-core" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
<defs><radialGradient id="cx-core-amber" cx="50%" cy="34%" r="72%"><stop offset="0" stop-color="#FFE3AE"/><stop offset=".45" stop-color="#F0A947"/><stop offset="1" stop-color="#A85A17"/></radialGradient><radialGradient id="cx-core-cyan" cx="50%" cy="34%" r="72%"><stop offset="0" stop-color="#DBFFFC"/><stop offset=".45" stop-color="#5BE4DF"/><stop offset="1" stop-color="#1E7F86"/></radialGradient></defs>
<circle class="cx-core-shell" cx="100" cy="100" r="97"/><circle class="cx-core-track" ${ring}/><circle class="cx-core-lit" ${ring}/><circle class="cx-core-ball" cx="100" cy="100" r="71"/>
<g class="cx-core-arrows"><path d="M56 80a50 50 0 0 1 88 0M146 64l-2 16-15-6"/><path d="M144 120a50 50 0 0 1-88 0M54 136l2-16 15 6"/></g></svg>`;

export class CosmicReactor {
  private track: SVGElement;
  private lit: SVGElement;
  private key = '';

  constructor(private svg: Element) {
    this.track = svg.querySelector('.cx-core-track')!;
    this.lit = svg.querySelector('.cx-core-lit')!;
  }

  paint(total: number, lit: number, sweep = false) {
    const segments = Math.max(1, Math.trunc(total)), on = Math.max(0, Math.min(segments, Math.trunc(lit)));
    const key = `${segments}:${on}:${sweep}`;
    if (key === this.key) return;
    this.key = key;
    const size = LENGTH / segments - GAP;
    this.track.style.strokeDasharray = `${size} ${GAP}`;
    this.lit.style.strokeDasharray = on ? Array.from({length: on}, (_, i) => `${size} ${i === on - 1 ? LENGTH : GAP}`).join(' ') : `0 ${LENGTH}`;
    (this.svg as SVGElement).dataset.segments = String(segments);
    (this.svg as SVGElement).dataset.lit = String(on);
    (this.svg as SVGElement).dataset.sweep = String(sweep);
  }
}
