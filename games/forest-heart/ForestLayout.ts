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
    const mode=width<=620?'mobile':height>width*1.08?'poster':'wide',mobile=mode==='mobile';
    this.root.dataset.layout=mode;this.root.dataset.compact=String(height<560);this.root.dataset.short=String(height<490);
    const parent=mobile?this.status:this.world;
    if(this.portrait.parentElement!==parent)parent.prepend(this.portrait);
    const css=this.root.ownerDocument.defaultView!.getComputedStyle(this.world);
    const padding=parseFloat(css.paddingLeft)+parseFloat(css.paddingRight);
    const availableWidth=Math.min(width,1320)-padding;
    const availableHeight=this.world.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom);
    const gap=mobile?4:8,source=mobile?44:56,flower=mobile?58:76;
    const portrait=mode==='wide'?Math.max(170,Math.min(270,availableWidth*.22)):0;
    const banner=mode==='poster'?64:0,columnsGap=mode==='wide'?16:0;
    const networkWidth=availableWidth-portrait-columnsGap;
    const capacity=Math.min(networkWidth-source-flower-gap*2,availableHeight-banner);
    const frameFor=(size:number)=>Math.max(8,Math.floor(size*(mobile?.04:.05)));
    let board=Math.max(128,Math.min(600,Math.floor(capacity/(mobile?1.08:1.1))));
    while(board>128&&board+2*frameFor(board)>capacity)board--;
    while(board<600&&board+1+2*frameFor(board+1)<=capacity)board++;
    const frame=frameFor(board);
    const values:Record<string,number>={board,frame,'source-width':source,'flower-width':flower,'network-gap':gap,'portrait-width':portrait,'scene-height':board+frame*2,'machine-width':board+frame*2+source+flower+gap*2};
    for(const [name,value] of Object.entries(values))this.root.style.setProperty('--'+name,value+'px');
    this.world.style.width=mode==='wide'?Math.min(width,values['machine-width']+portrait+columnsGap+padding)+'px':'100%';
    this.machine.style.maxWidth='100%';
  }
  destroy(){this.observer.disconnect();if(this.raf)this.root.ownerDocument.defaultView!.cancelAnimationFrame(this.raf);}
}
