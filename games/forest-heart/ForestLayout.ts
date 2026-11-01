import { gameContentLayout } from '../../src/ui/GameLayoutPolicy';

/** Fits the existing network and live artwork to the space supplied by the host. */
export class ForestLayout {
  private observer: ResizeObserver;
  private raf = 0;
  private compact = false;
  private world: HTMLElement;
  private machine: HTMLElement;
  private panel: HTMLElement;
  private controls: HTMLElement;
  private tools: HTMLElement;
  private homes: {node:HTMLElement;marker:Comment}[];
  constructor(private root: HTMLElement) {
    this.world=root.querySelector('.fh-world')!;this.machine=root.querySelector('.fh-machine')!;
    this.panel=root.querySelector('[data-panel=settings]')!;this.controls=root.querySelector('.fh-controls')!;this.tools=root.querySelector('.fh-tools')!;
    this.homes=['.fh-character','.fh-tools','.fh-fast','[data-fh=sound]','[data-fh=rules]'].map(selector=>{
      const node=root.querySelector<HTMLElement>(selector)!,marker=root.ownerDocument.createComment('forest layout');node.before(marker);return{node,marker};
    });
    this.observer=new ResizeObserver(()=>this.schedule());
    for(const element of [root,this.world,this.controls,root.querySelector('.fh-status-band')!])this.observer.observe(element);
    this.fit();
  }
  private schedule(){if(!this.raf)this.raf=this.root.ownerDocument.defaultView!.requestAnimationFrame(()=>{this.raf=0;this.fit();});}
  private fit(){
    const profile=gameContentLayout(this.root.clientWidth,this.root.clientHeight),compact=profile!=='full';
    this.root.dataset.frameLayout=profile;this.root.dataset.layout=profile==='full'?'wide':profile==='portrait'?'mobile':'landscape';
    this.root.dataset.compact=String(compact);this.root.dataset.short=String(this.root.clientHeight<490);
    if(compact!==this.compact){
      this.compact=compact;
      if(compact)for(const{node}of this.homes)(node===this.tools?this.controls:this.panel).append(node);
      else for(const{node,marker}of [...this.homes].reverse())marker.after(node);
    }
    const css=this.root.ownerDocument.defaultView!.getComputedStyle(this.world);
    const availableWidth=this.world.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight);
    const availableHeight=this.world.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom);
    const source=compact?44:56,gap=compact?2:8;
    const frameFor=(size:number)=>compact?6:Math.max(8,Math.floor(size*.04));
    const flowerFor=(size:number)=>compact?32:Math.min(128,Math.max(80,Math.round(size*.22)));
    const portraitFor=(size:number)=>compact?0:Math.floor((size+frameFor(size)*2)*.5);
    const fits=(size:number)=>size+frameFor(size)*2+source+flowerFor(size)+gap*2+portraitFor(size)+(compact?0:16)<=availableWidth&&size+frameFor(size)*2<=availableHeight;
    let board=32;while(board<1040&&fits(board+1))board++;
    const frame=frameFor(board),flower=flowerFor(board),scene=board+frame*2;
    const values:Record<string,number>={board,frame,'source-width':source,'flower-width':flower,'network-gap':gap,'portrait-width':portraitFor(board),'portrait-banner-height':0,'scene-height':scene,'machine-width':scene+source+flower+gap*2};
    for(const[name,value]of Object.entries(values))this.root.style.setProperty('--'+name,value+'px');
    this.machine.style.maxWidth='100%';
  }
  destroy(){this.observer.disconnect();if(this.raf)this.root.ownerDocument.defaultView!.cancelAnimationFrame(this.raf);for(const{node,marker}of [...this.homes].reverse())marker.replaceWith(node);}
}
