const chestArt = `<svg viewBox="0 0 64 44" aria-hidden="true">
 <path fill="#5b3020" stroke="#ffd682" stroke-width="2" d="M8 23h48v14a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z"/>
 <path fill="#975737" d="M11 26h42v9H11z"/>
 <path fill="#ffcc70" d="M14 25h3v14h-3zm33 0h3v14h-3z"/>
 <path fill="#f1a94c" stroke="#ffebb0" d="M28 24h8v10h-8z"/>
 <path fill="#62301a" d="M31 28h2v3h-2z"/>
 <g class="ct-chest-lid">
  <path fill="#a0552b" stroke="#ffd682" stroke-width="2" d="M8 23v-5c0-7 5-11 12-11h24c7 0 12 4 12 11v5z"/>
  <path fill="#d68848" d="M11 16c1-4 5-6 10-6h23c4 0 7 2 9 6z"/>
  <path fill="#ffd682" d="M14 12h3v11h-3zm33 0h3v11h-3zM8 20h48v3H8z"/>
 </g>
</svg>`;

type EffectPoint = { x: number; y: number };

/** Short, owned animations. Data, money and operation identity stay in the shared game. */
export class CaribbeanMotion{
 private animations=new Set<Animation>();private particles=new Set<HTMLElement>();private particleLayer?:HTMLElement;
 constructor(private root:HTMLElement,private reduced:()=>boolean){}
 private animate(node:Element|null,frames:Keyframe[],options:KeyframeAnimationOptions){
  if(!node||this.reduced()||document.hidden)return;
  const animation=node.animate(frames,options);this.animations.add(animation);void animation.finished.catch(()=>{}).finally(()=>this.animations.delete(animation));return animation;
 }
 land(column:number){
  for(const cell of Array.from(this.root.querySelectorAll<HTMLElement>('.ct-cell')))if(Number(cell.dataset.ctCell)%6===column){
   this.animate(cell.querySelector('.ct-symbol'),[
    {transform:'translateY(-26%) scale(.96,1.1)',opacity:.72},
    {transform:'translateY(6%) scale(1.07,.91)',opacity:1,offset:.48},
    {transform:'translateY(-2%) scale(.985,1.025)',opacity:1,offset:.76},
    {transform:'none',opacity:1},
   ],{duration:270,easing:'ease-out'});
   this.animate(cell,[
    {boxShadow:'inset 0 -6px 16px #94f0eb8c'},
    {boxShadow:'inset 0 -2px 8px #65c9d94d',offset:.55},
    {boxShadow:'inset 0 0 0 transparent'},
   ],{duration:245,easing:'ease-out'});
  }
 }
 giant(){this.animate(this.root.querySelector('.ct-giant>.ct-symbol'),[{transform:'translateY(7%) scale(.82)',opacity:.4},{transform:'translateY(-1%) scale(1.035)',opacity:1,offset:.72},{transform:'none',opacity:1}],{duration:340,easing:'cubic-bezier(.16,.7,.3,1)'});}
 cannon(before:DOMRect|undefined){
  const giant=this.root.querySelector<HTMLElement>('.ct-giant'),after=giant?.getBoundingClientRect();
  if(giant&&before&&after)this.animate(giant,[{transformOrigin:'0 0',transform:`translate(${before.x-after.x}px,${before.y-after.y}px) scale(${before.width/after.width},${before.height/after.height})`},{transformOrigin:'0 0',transform:'none'}],{duration:380,easing:'cubic-bezier(.16,.75,.25,1)'});
  this.animate(this.root.querySelector('.ct-board-wrap'),[{transform:'none'},{transform:'translate(3px, 1px)',offset:.18},{transform:'translate(-1.5px, 0)',offset:.5},{transform:'none'}],{duration:220,easing:'ease-out'});
 }
 outcome(big:boolean){
  if(this.reduced()||document.hidden)return;
  const status=this.root.querySelector<HTMLElement>('.ct-status[data-win]:not([data-win=""])');
  const payout=this.root.querySelector<HTMLElement>('[data-ct-payout]');
  if(!status||!payout)return;
  this.animate(status,[
   {boxShadow:'inset 0 0 0 1px #e1b66b, inset 0 0 16px #e1b66b55'},
   {boxShadow:'inset 0 0 0 1px #c69b575c'},
  ],{duration:big?950:580,easing:'ease-out'});
  this.animate(this.root.querySelector('[data-ct-net]'),[
   {transform:'scale(.94)'},{transform:big?'scale(1.13)':'scale(1.08)',offset:.38},{transform:'none'},
  ],{duration:big?700:450,easing:'ease-out'});
  this.clearParticles();
  const layer=document.createElement('span');
  layer.className='ct-sparks';layer.setAttribute('aria-hidden','true');
  this.root.append(layer);this.particleLayer=layer;
  const {left,top}=layer.getBoundingClientRect(), plaque=status.getBoundingClientRect(), total=payout.getBoundingClientRect();
  const target={x:plaque.left+plaque.width/2-left,y:plaque.top+3-top};
  const fallback={x:total.left+total.width/2-left,y:total.top+total.height/2-top};
  const route=this.root.querySelector<SVGPathElement>('.ct-win-route'),matrix=route?.getScreenCTM();
  if(route&&matrix){
   this.animate(route,[
    {strokeDashoffset:'1',opacity:.3},{strokeDashoffset:'0',opacity:.95,offset:.45},{strokeDashoffset:'0',opacity:0},
   ],{duration:570,easing:'ease-out'});
   const length=route.getTotalLength();
   for(let index=0;index<5;index++){
    const point=route.getPointAtLength(length*(.54+index*.11)).matrixTransform(matrix);
    this.fly(layer,{x:point.x-left,y:point.y-top},target,index,false);
   }
  }else for(let index=0;index<5;index++)this.fly(layer,fallback,target,index,false);

  if(big){
   const board=this.root.querySelector('.ct-board');
   const field=board?.getBoundingClientRect(),stage=this.root.querySelector('.ct-stage')?.getBoundingClientRect();
   this.animate(board,[
    {boxShadow:'inset 0 0 35px #000b, 0 0 12px #ebb75c55'},
    {boxShadow:'inset 0 0 26px #aa794047, 0 0 26px #ffd77988',offset:.3},
    {boxShadow:'inset 0 0 35px #000b, 0 14px 24px #00131c99'},
   ],{duration:980,easing:'ease-out'});
   const chest=document.createElement('span');
   chest.className='ct-loot-chest';chest.innerHTML=chestArt;
   const position=field&&stage&&field.right+78<stage.right
    ? {x:field.right-left+14,y:field.bottom-top-34}
    : {x:plaque.left-left+12,y:plaque.top-top+(plaque.height-34)/2};
   chest.style.left=position.x+'px';chest.style.top=position.y+'px';
   layer.append(chest);
   this.trackParticle(layer,chest,this.animate(chest,[
    {transform:'translateY(4px) scale(.7)',opacity:0},
    {transform:'none',opacity:1,offset:.18},
    {transform:'none',opacity:1,offset:.76},
    {transform:'translateY(2px) scale(.92)',opacity:0},
   ],{duration:1180,easing:'ease-out'}));
   this.animate(chest.querySelector('.ct-chest-lid'),[
    {transform:'none'},{transform:'none',offset:.15},{transform:'rotate(-22deg) translateY(-2px)',offset:.36},{transform:'rotate(-18deg) translateY(-2px)'},
   ],{duration:1180,easing:'ease-out'});
   const mouth={x:position.x+27,y:position.y+14};
   for(let index=0;index<6;index++)this.fly(layer,mouth,target,index,true);
  }
 }
 private fly(layer:HTMLElement,from:EffectPoint,to:EffectPoint,index:number,coin:boolean){
  const particle=document.createElement('i');
  particle.className=coin?'ct-loot-coin':'ct-treasure-spark';
  particle.style.left=from.x+'px';particle.style.top=from.y+'px';
  layer.append(particle);
  const x=to.x-from.x+(index-2)*8,y=to.y-from.y;
  this.trackParticle(layer,particle,this.animate(particle,[
   {transform:'translate(-50%, -50%) scale(.45)',opacity:0},
   {transform:`translate(calc(-50% + ${x*.19}px), calc(-50% + ${y*.18-22-index*3}px)) rotate(30deg) scale(1.12)`,opacity:1,offset:.26},
   {transform:`translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(100deg) scale(.4)`,opacity:0},
  ],{duration:coin?700:580,delay:(coin?220:45)+index*42,easing:'cubic-bezier(.24,.65,.44,1)',fill:'both'}));
 }
 private trackParticle(layer:HTMLElement,particle:HTMLElement,animation:Animation|undefined){
  if(!animation){particle.remove();return;}
  this.particles.add(particle);
  void animation.finished.catch(()=>{}).finally(()=>{
   particle.remove();this.particles.delete(particle);
   if(this.particleLayer===layer&&!this.particles.size){layer.remove();this.particleLayer=undefined;}
  });
 }
 async tally(from:string,to:string,duration:number,signal:AbortSignal,draw:(units:string)=>void){
  if(signal.aborted)return;if(this.reduced()){draw(to);return;}
  const a=BigInt(from),difference=BigInt(to)-a,start=performance.now();
  await new Promise<void>(resolve=>{
   let frame=0;const finish=()=>{cancelAnimationFrame(frame);signal.removeEventListener('abort',finish);resolve();};
   const tick=(now:number)=>{if(signal.aborted){finish();return;}const t=Math.min(1,(now-start)/duration),progress=Math.round((1-(1-t)**3)*10000);draw(String(a+difference*BigInt(progress)/10000n));if(t===1){draw(to);finish();}else frame=requestAnimationFrame(tick);};
   signal.addEventListener('abort',finish,{once:true});frame=requestAnimationFrame(tick);
  });
 }
 private clearParticles(){this.particles.clear();this.particleLayer?.remove();this.particleLayer=undefined;}
 cancel(){for(const animation of this.animations)animation.cancel();this.animations.clear();this.clearParticles();}
 state(){return{animations:[...this.animations].filter(a=>a.playState==='running'||a.pending).length,particles:this.particles.size};}
}
