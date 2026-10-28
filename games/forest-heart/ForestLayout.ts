/** Fits the actual Royal iframe, including its chat-driven dimensions. No game state is changed. */
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
    const mode=width<=620?'mobile':height>width*1.08?'poster':'wide';
    this.root.dataset.layout=mode;this.root.dataset.compact=String(height<490);
    const parent=mode==='mobile'?this.status:this.world;
    if(this.portrait.parentElement!==parent)parent.prepend(this.portrait);
    const css=this.root.ownerDocument.defaultView!.getComputedStyle(this.world);
    const horizontalPadding=parseFloat(css.paddingLeft)+parseFloat(css.paddingRight);
    const availableWidth=Math.min(width,1320)-horizontalPadding;
    const availableHeight=this.world.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom);
    const compact=height<490,mobile=mode==='mobile';
    const status=compact?54:mobile?64:58,gap=mobile?5:10,source=mobile?32:60,flower=mobile?40:76;
    const portrait=mode==='wide'?Math.max(170,Math.min(320,availableWidth*.28)):0;
    const banner=mode==='poster'?88:0,columnsGap=mode==='wide'?22:0;
    const networkWidth=availableWidth-portrait-columnsGap;
    const maxBoard=Math.min((networkWidth-source-flower-gap*2)/1.14,(availableHeight-status-10-banner)/1.14,600);
    const board=Math.max(128,Math.floor(maxBoard)),frame=Math.round(Math.min(34,Math.max(10,board*.07)));
    const values:Record<string,number>={board,frame,'source-width':source,'flower-width':flower,'network-gap':gap,'portrait-width':portrait,'status-height':status,'scene-height':board+frame*2+status+10,'machine-width':board+frame*2+source+flower+gap*2};
    for(const [name,value] of Object.entries(values))this.root.style.setProperty('--'+name,value+'px');
    this.world.style.width=mode==='wide'?Math.min(width,values['machine-width']+portrait+columnsGap+horizontalPadding)+'px':'100%';
    this.machine.style.maxWidth='100%';
  }
  destroy(){this.observer.disconnect();if(this.raf)this.root.ownerDocument.defaultView!.cancelAnimationFrame(this.raf);}
}
