import { STUDIO_GAMES, STUDIO_INFO, type StudioGameId } from '../shared/studioGames';
import { STUDIO_ART, studioEscape as escape } from './StudioArtwork';
import './studio-catalog.css';

type Filter = 'all'|'slot'|'risk'|'other';
const labels: Record<Filter,string> = {all:'Все',slot:'Слоты',risk:'Полёт и риск',other:'Другие'};
const match = (game: StudioGameId, filter: Filter) => filter==='all'||filter==='slot'&&STUDIO_INFO[game].kind==='slot'||filter==='risk'&&['crash','flight'].includes(STUDIO_INFO[game].kind)||filter==='other'&&!['slot','crash','flight'].includes(STUDIO_INFO[game].kind);
const sorted = [...STUDIO_GAMES].sort((first,second)=>Number(STUDIO_INFO[second].kind==='slot')-Number(STUDIO_INFO[first].kind==='slot'));
const kindNames = {slot:'СЛОТ',crash:'МАРШРУТ',flight:'ПОЛЁТ',keno:'КЕНО',plinko:'ПЛИНКО',dice:'КОСТИ',wheel:'КОЛЕСО',mines:'ПОИСК'};

/** Native games from the club's collection, all connected to one test wallet. */
export class StudioCatalog {
  private filter: Filter = 'all';
  private destroyed = false;
  constructor(private host: HTMLElement, private select: (game: StudioGameId)=>void) { this.render(); }

  private render(focus?: string) {
    if(this.destroyed)return;
    const games=sorted.filter(game=>match(game,this.filter));
    this.host.innerHTML=`<section class="studio-catalog" aria-label="Новые слоты и казино-игры"><div class="studio-catalog-heading"><div><span>ROYAL STUDIO</span><h3>Миры удачи</h3></div><strong>${STUDIO_GAMES.length}<small>новых игр</small></strong></div><p>23 слота с линиями, способами и бонусами. Один тестовый кошелёк для всей коллекции.</p><div class="studio-catalog-tabs" role="group" aria-label="Категории коллекции">${(['all','slot','risk','other'] as Filter[]).map(filter=>`<button type="button" data-studio-filter="${filter}" aria-pressed="${this.filter===filter}">${labels[filter]}<span>${STUDIO_GAMES.filter(game=>match(game,filter)).length}</span></button>`).join('')}</div><div class="studio-catalog-grid">${games.map(game=>{const info=STUDIO_INFO[game],index=STUDIO_GAMES.indexOf(game);const mode=info.kind==='slot'?info.paylines.length?`${info.paylines.length} линий`:info.ways?`${info.ways} способов`:info.features.includes('cluster')?'Группы символов':'Каскады':kindNames[info.kind];return `<button type="button" class="studio-catalog-card theme-${info.theme}" data-studio="${game}" aria-label="Играть в ${escape(info.name)}" style="--studio-card-accent:${info.palette[1]}"><span class="studio-catalog-art"><img src="${STUDIO_ART[info.theme]}" alt="" loading="lazy" style="object-position:${25+index%3*25}% ${30+index%2*30}%"><span class="studio-catalog-kind">${kindNames[info.kind]}</span><span class="studio-catalog-mode">${escape(mode)}</span></span><span class="studio-catalog-copy"><strong>${escape(info.name)}</strong><small>${escape(info.subtitle)}</small></span><span class="studio-catalog-arrow" aria-hidden="true">↗</span></button>`;}).join('')}</div><div class="studio-catalog-footer"><span>В коллекции: ${games.length}</span><span>Тестовые монеты</span></div></section>`;
    this.host.querySelectorAll<HTMLButtonElement>('[data-studio-filter]').forEach(button=>button.onclick=()=>{this.filter=button.dataset.studioFilter as Filter;this.render(this.filter);});
    this.host.querySelectorAll<HTMLButtonElement>('[data-studio]').forEach(button=>button.onclick=()=>this.select(button.dataset.studio as StudioGameId));
    if(focus)this.host.querySelector<HTMLButtonElement>(`[data-studio-filter="${focus}"]`)?.focus({preventScroll:true});
  }

  destroy(){this.destroyed=true;this.host.replaceChildren();}
}
