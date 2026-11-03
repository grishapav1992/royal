import {gameContentLayout} from '../../src/ui/GameLayoutPolicy';

/** Measure the host's remaining pane, without scaling controls or replacing live state. */
export class StarSpinLayout {
  private observer:ResizeObserver;
  private frame=0;
  private dead=false;
  private schedule=()=>{if(!this.dead&&!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.fit();});};
  constructor(private root:HTMLElement){
    this.observer=new ResizeObserver(this.schedule);
    this.observer.observe(root);
    this.observer.observe(root.querySelector('.gn-stage')!);
    this.fit();
  }
  private fit(){
    const {width,height}=this.root.getBoundingClientRect();
    this.root.dataset.layout=gameContentLayout(width,height);
    this.root.dataset.portraitCompact=String(height<620);
    const stage=this.root.querySelector<HTMLElement>('.gn-stage')!;
    const board=this.root.querySelector<HTMLElement>('.gn-board')!;
    const size=Math.max(1,Math.floor(Math.min(stage.clientWidth-16,(stage.clientHeight-16)*5/3,1000)));
    board.style.width=size+'px';board.style.height=size*3/5+'px';board.style.setProperty('--cell',size/5+'px');
  }
  destroy(){this.dead=true;cancelAnimationFrame(this.frame);this.observer.disconnect();}
}
