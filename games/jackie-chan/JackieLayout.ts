/** Follow the actual game stage, including the space reserved for the connected chat. */
export class JackieLayout {
  private stage:HTMLElement|null;
  private sizes:ResizeObserver;
  private frame=0;
  private dead=false;
  private schedule=()=>{if(!this.dead&&!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.update();});};
  constructor(private host:HTMLElement,private root:HTMLElement){
    this.stage=host.closest<HTMLElement>('.mini-stage');
    host.classList.add('jc-host');root.classList.add('jc-fit');
    this.sizes=new ResizeObserver(this.schedule);this.sizes.observe(this.stage??host);
    window.addEventListener('resize',this.schedule);window.visualViewport?.addEventListener('resize',this.schedule);
    this.update();
  }
  private update(){
    const width=this.stage?.clientWidth??this.host.clientWidth;
    const height=this.stage?.clientHeight??Math.max(200,(window.visualViewport?.height??innerHeight)-this.host.getBoundingClientRect().top-16);
    if(width<1||height<1)return;
    const value=Math.floor(height)+'px';
    if(this.host.style.getPropertyValue('--jc-viewport-height')!==value)this.host.style.setProperty('--jc-viewport-height',value);
    this.root.dataset.layout=width>=740||width>=500&&width/height>=1.35?'side':'stack';
    this.root.dataset.compact=String(height<560);
  }
  destroy(){this.dead=true;cancelAnimationFrame(this.frame);this.sizes.disconnect();window.removeEventListener('resize',this.schedule);window.visualViewport?.removeEventListener('resize',this.schedule);this.host.classList.remove('jc-host');this.host.style.removeProperty('--jc-viewport-height');}
}
