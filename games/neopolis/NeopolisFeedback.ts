import type { Frame } from '../../src/shared/neopolisMath';
import type { neopolisCopy } from './copy';
import { accentLead, motionClock, waitMotion, type MotionOptions } from './NeopolisMotion';

type Copy = ReturnType<typeof neopolisCopy>;
export type RoundTier = 'loss' | 'partial' | 'even' | 'win' | 'big' | 'epic';
// Presentation thresholds for this prototype, measured against the full paid round.
export function roundTier(payout: number, stake: number): RoundTier {
  return payout===0 ? 'loss' : payout<stake ? 'partial' : payout===stake ? 'even' : payout>=stake*25 ? 'epic' : payout>=stake*10 ? 'big' : 'win';
}
const ease = (t: number) => 1-(1-Math.min(1,Math.max(0,t)))**3;

/** Payout presentation only. Units are already confirmed and capped by the host. */
export class NeopolisFeedback {
  private award: HTMLElement;
  private result: HTMLElement;
  private line?: SVGSVGElement;
  private skip = false;
  private phase = 'idle';
  private shownUnits = 0;
  private lastRound?: {tier:RoundTier;payout:number;stake:number;net:number};
  private controller = new AbortController();
  private board: HTMLElement;

  constructor(private root: HTMLElement, private copy: Copy, private number: (n: number)=>string,
    private amount: (units: number)=>void, private reduced: ()=>boolean,
    private impact: (kind:'win'|'big'|'epic',cells:number[])=>void) {
    const doc=root.ownerDocument,shell=root.querySelector('.np-board-shell')!;
    this.board=root.querySelector('.np-board')!;
    this.award=doc.createElement('div'); this.award.className='np-award'; this.award.setAttribute('aria-hidden','true');
    this.award.innerHTML='<small></small><strong></strong><span></span>';
    this.result=doc.createElement('div'); this.result.className='np-result'; this.result.hidden=true;
    this.result.innerHTML='<div class="np-result-orbit" aria-hidden="true"></div><div class="np-result-panel"><small>'+copy.roundPayout+'</small><h2></h2><strong data-result-amount></strong><span data-result-net></span><button type="button" data-result-skip>'+copy.showTotal+'</button></div>';
    shell.append(this.award,this.result);
    this.result.querySelector('button')!.addEventListener('click',()=>{this.skip=true;},{signal:this.controller.signal});
  }
  setAmount(units: number) { this.shownUnits=units; this.amount(units); }
  private cleanLines() {
    this.line?.remove(); this.line=undefined;
    this.board.querySelectorAll('.np-paying').forEach(cell=>cell.classList.remove('np-paying'));
    this.board.style.removeProperty('--np-win-pulse');
    this.award.classList.remove('np-award-visible'); delete this.board.dataset.presentation; delete this.board.dataset.impact;
  }
  async win(frame: Frame, from: number, to: number, options: MotionOptions, chain: number) {
    this.cleanLines(); this.phase='combination';
    const cells=Array.from(this.board.querySelectorAll('[role=gridcell]'));
    for(const cell of frame.cells) cells[cell]?.classList.add('np-paying');
    this.board.dataset.presentation='win';
    const svg=this.root.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 500 400'); svg.setAttribute('preserveAspectRatio','none'); svg.setAttribute('aria-hidden','true'); svg.classList.add('np-paylines');
    for(const win of [...frame.wins].sort((a,b)=>b.points-a.points).slice(0,3)) {
      const path=this.root.ownerDocument.createElementNS(svg.namespaceURI,'polyline');
      path.setAttribute('points',win.cells.map(cell=>(50+cell%5*100)+','+(50+Math.floor(cell/5)*100)).join(' '));
      svg.append(path);
    }
    this.board.append(svg); this.line=svg;
    const gain=to-from;
    this.award.querySelector('small')!.textContent=this.copy.combination;
    this.award.querySelector('span')!.textContent=this.copy.linesPaid.replace('{n}',String(frame.wins.length));
    const label=this.award.querySelector('strong')!;
    if(this.reduced()) { this.setAmount(to); this.cleanLines(); this.phase='idle'; return; }
    const lead=accentLead(options),count=options.fast ? 170 : 320,hold=options.fast ? 70 : 150;
    const clock=motionClock(this.board,options,elapsed=>{
      const t=Math.max(0,elapsed-lead),progress=ease(t/count);
      const value=from+Math.floor((to-from)*progress); this.setAmount(value);
      label.textContent=(gain>0 ? '+' : '')+this.number(Math.floor(gain*progress)/100);
      this.board.style.setProperty('--np-win-pulse',String(t<count ? Math.sin(Math.min(1,t/count)*Math.PI) : 0));
      return elapsed<lead+count+hold;
    });
    clock.cue('combination',lead,gain>0 ? [{cue:'win',variant:Math.min(chain,4)}] : [],()=>{
      this.board.dataset.impact='win'; this.award.classList.add('np-award-visible');
      if(gain>0) this.impact('win',frame.cells);
    });
    await clock.done;
    if(!options.signal.aborted) this.setAmount(to);
    this.cleanLines(); this.phase='idle';
  }

  async finish(payout: number, stake: number, options: MotionOptions) {
    this.cleanLines(); this.skip=false;
    const tier=roundTier(payout,stake); this.lastRound={tier,payout,stake,net:payout-stake};
    this.root.dataset.outcome=tier;
    if(tier==='loss'||tier==='partial'||tier==='even') {
      this.setAmount(payout); this.phase='idle';
      return;
    }
    this.phase='result'; this.result.hidden=false; this.result.dataset.tier=tier; this.result.dataset.sealed='false';
    this.result.querySelector('h2')!.textContent=tier==='epic' ? this.copy.epicWin : tier==='big' ? this.copy.bigWin : this.copy.roundWin;
    this.result.querySelector('[data-result-net]')!.textContent=this.copy.netResult+': +'+this.number((payout-stake)/100);
    const counter=this.result.querySelector('[data-result-amount]')!;
    const render=(progress:number)=>{counter.textContent=this.number(Math.floor(payout*progress)/100);};
    if(this.reduced()) {
      render(1); this.setAmount(payout); options.audio?.play('round-'+tier as 'round-win'|'round-big'|'round-epic');
      await waitMotion(this.result,120,options);
    } else {
      const lead=accentLead(options),duration=(tier==='epic' ? 1700 : tier==='big' ? 1250 : 650)*(options.fast ? .65 : 1);
      const clock=motionClock(this.result,options,elapsed=>{
        const progress=ease((elapsed-lead)/duration); render(this.skip ? 1 : progress);
        this.result.style.setProperty('--np-result-progress',String(progress));
        if(this.skip) { this.result.dataset.sealed='true'; options.audio?.cancelEffects(); return false; }
        return elapsed<lead+duration+230;
      });
      clock.cue('result-open',lead,[{cue:'round-'+tier as 'round-win'|'round-big'|'round-epic'}],()=>{
        this.result.dataset.revealed='true'; this.impact(tier==='win' ? 'win' : tier,[]);
      });
      if(tier!=='win') for(let i=1;i<=3;i++) clock.cue('tally-'+i,lead+duration*i/4,[{cue:'tally',variant:i-1}]);
      clock.cue('result-seal',lead+duration,[{cue:'round-end'}],()=>this.result.dataset.sealed='true');
      await clock.done;
      if(!options.signal.aborted) { render(1); this.setAmount(payout); }
    }
    this.result.hidden=true; delete this.result.dataset.revealed; this.phase='idle';
  }
  clear() { this.cleanLines(); this.result.hidden=true; this.skip=false; this.phase='idle'; this.lastRound=undefined; delete this.root.dataset.outcome; }
  getState() { return {phase:this.phase,shownUnits:this.shownUnits,round:this.lastRound ? {...this.lastRound} : null}; }
  destroy() { this.controller.abort(); this.clear(); this.result.remove(); this.award.remove(); }
}
