/** Fits only the presentation inside the real Royal host and its connected chat. */
export class ForestLayout {
  private observer: ResizeObserver;
  private raf = 0;
  private world: HTMLElement;
  private machine: HTMLElement;
  private portrait: HTMLElement;
  private status: HTMLElement;
  constructor(private root: HTMLElement) {
    this.world=root.querySelector('.fh-world')!;this.machine=root.querySelector('.fh-machine')!;
    this.portrait=root.querySelector('.fh-character')!;this.status=root.querySelector('.fh-status-band')!;
    this.observer=new ResizeObserver(()=>this.schedule());this.observer.observe(root);this.observer.observe(this.world);this.fit();
  }
  private schedule(){if(!this.raf)this.raf=this.root.ownerDocument.defaultView!.requestAnimationFrame(()=>{this.raf=0;this.fit();});}
  private fit(){
    const width=this.root.clientWidth,height=this.root.clientHeight;
    const mode=height<440&&width>=360?'landscape':width<=620?'mobile':height>width*1.08?'poster':'wide';
    const mobile=mode==='mobile',landscape=mode==='landscape',small=mobile||landscape;
    this.root.dataset.layout=mode;this.root.dataset.compact=String(height<560);this.root.dataset.short=String(height<490);
    const parent=small?this.status:this.world;
    if(this.portrait.parentElement!==parent){if(small)parent.prepend(this.portrait);else parent.append(this.portrait);}
    const css=this.root.ownerDocument.defaultView!.getComputedStyle(this.world);
    const padding=parseFloat(css.paddingLeft)+parseFloat(css.paddingRight);
    const sidebar=landscape?(width<540?172:208):0;
    this.root.style.setProperty('--landscape-controls-width',sidebar+'px');
    const availableWidth=(landscape?width-sidebar:Math.min(width,1600))-padding;
    const availableHeight=this.world.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom);
    const gap=small?4:8,source=mobile?44:landscape?36:56,flower=mobile?58:landscape?48:76;
    const banner=mode==='poster'?Math.min(240,Math.max(104,Math.floor(availableHeight*.26))):0;
    const columnsGap=mode==='wide'?24:0,portraitRatio=mode==='wide'?.68:0;
    const frameFor=(size:number)=>Math.max(8,Math.floor(size*(small?.04:.05)));
    const fits=(size:number)=>{
      const scene=size+frameFor(size)*2;
      return scene*(1+portraitRatio)+source+flower+gap*2+columnsGap<=availableWidth&&scene+banner+(banner?8:0)<=availableHeight;
    };
    let board=128;
    while(board<780&&fits(board+1))board++;
    const frame=frameFor(board),scene=board+frame*2,portrait=Math.floor(scene*portraitRatio);
    const values:Record<string,number>={board,frame,'source-width':source,'flower-width':flower,'network-gap':gap,'portrait-width':portrait,'portrait-banner-height':banner,'scene-height':scene,'machine-width':scene+source+flower+gap*2};
    for(const [name,value] of Object.entries(values))this.root.style.setProperty('--'+name,value+'px');
    this.world.style.removeProperty('width');
    this.machine.style.maxWidth='100%';
  }
  destroy(){this.observer.disconnect();if(this.raf)this.root.ownerDocument.defaultView!.cancelAnimationFrame(this.raf);}
}
