/** Short, owned animations. Data, money and operation identity stay in the shared game. */
export class CaribbeanMotion{
 private animations=new Set<Animation>();private particles:HTMLElement[]=[];private particleLayer?:HTMLElement;
 constructor(private root:HTMLElement,private reduced:()=>boolean){}
 private animate(node:Element|null,frames:Keyframe[],options:KeyframeAnimationOptions){
  if(!node||this.reduced()||document.hidden)return;
  const animation=node.animate(frames,options);this.animations.add(animation);void animation.finished.catch(()=>{}).finally(()=>this.animations.delete(animation));return animation;
 }
 land(column:number){
  for(const cell of Array.from(this.root.querySelectorAll<HTMLElement>('.ct-cell')))if(Number(cell.dataset.ctCell)%6===column){
   this.animate(cell.querySelector('.ct-symbol'),[
    {transform:'translateY(-22%) scale(.94,1.06)',opacity:.72},
    {transform:'translateY(4%) scale(1.04,.96)',opacity:1,offset:.58},
    {transform:'none',opacity:1},
   ],{duration:230,easing:'cubic-bezier(.15,.6,.25,1)'});
   this.animate(cell,[{boxShadow:'inset 0 -5px 16px #85c6d760'},{boxShadow:'inset 0 0 0 transparent'}],{duration:230,easing:'ease-out'});
  }
 }
 giant(){this.animate(this.root.querySelector('.ct-giant>.ct-symbol'),[{transform:'translateY(7%) scale(.82)',opacity:.4},{transform:'translateY(-1%) scale(1.035)',opacity:1,offset:.72},{transform:'none',opacity:1}],{duration:340,easing:'cubic-bezier(.16,.7,.3,1)'});}
 cannon(before:DOMRect|undefined){
  const giant=this.root.querySelector<HTMLElement>('.ct-giant'),after=giant?.getBoundingClientRect();
  if(giant&&before&&after)this.animate(giant,[{transformOrigin:'0 0',transform:`translate(${before.x-after.x}px,${before.y-after.y}px) scale(${before.width/after.width},${before.height/after.height})`},{transformOrigin:'0 0',transform:'none'}],{duration:380,easing:'cubic-bezier(.16,.75,.25,1)'});
  this.animate(this.root.querySelector('.ct-board-wrap'),[{transform:'none'},{transform:'translate(2px, 1px)',offset:.2},{transform:'translate(-1px, 0)',offset:.55},{transform:'none'}],{duration:180,easing:'ease-out'});
 }
 outcome(big:boolean){
  if(this.reduced()||document.hidden)return;const board=this.root.querySelector<HTMLElement>('.ct-board');if(!board)return;
  this.animate(this.root.querySelector('.ct-status'),[
   {boxShadow:'inset 0 0 0 1px #e1b66b, inset 0 0 16px #e1b66b55'},
   {boxShadow:'inset 0 0 0 1px #c69b575c'},
  ],{duration:big?950:580,easing:'ease-out'});
  this.animate(this.root.querySelector('[data-ct-net]'),[
   {transform:'scale(.94)'},{transform:big?'scale(1.13)':'scale(1.08)',offset:.38},{transform:'none'},
  ],{duration:big?700:450,easing:'ease-out'});
  this.clearParticles();const count=big?14:7;
  const layer=document.createElement('span');layer.className='ct-sparks';layer.setAttribute('aria-hidden','true');board.append(layer);this.particleLayer=layer;
  for(let i=0;i<count;i++){
   const particle=document.createElement('i');particle.className='ct-treasure-spark';particle.setAttribute('aria-hidden','true');particle.style.left=(8+(i*37)%84)+'%';particle.style.top=(18+(i*19)%58)+'%';layer.append(particle);this.particles.push(particle);
   const animation=this.animate(particle,[{transform:'translate(0, 10px) scale(.2)',opacity:0},{transform:'translate(0, -5px) scale(1)',opacity:.8,offset:.25},{transform:`translate(${(i%2?1:-1)*(10+i%4*7)}px, ${-25-i%5*11}px) scale(.2)`,opacity:0}],{duration:big?1100:760,delay:i*24,easing:'ease-out'});
   void animation?.finished.catch(()=>{}).finally(()=>{particle.remove();this.particles=this.particles.filter(p=>p!==particle);if(!this.particles.length){this.particleLayer?.remove();this.particleLayer=undefined;}});
  }
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
 private clearParticles(){for(const particle of this.particles)particle.remove();this.particles=[];this.particleLayer?.remove();this.particleLayer=undefined;}
 cancel(){for(const animation of this.animations)animation.cancel();this.animations.clear();this.clearParticles();}
 state(){return{animations:[...this.animations].filter(a=>a.playState==='running'||a.pending).length,particles:this.particles.length};}
}
