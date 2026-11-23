/** Size the cabinet from the space allocated by the host, including its chat. */
export class NitroRunLayout {
 private observer: ResizeObserver;
 constructor(private root: HTMLElement) {
  this.observer = new ResizeObserver(() => this.resize());
  this.observer.observe(root);
  this.resize();
 }
 private resize() {
  const {width,height} = this.root.getBoundingClientRect();
  if(!width||!height)return;
  const compact=height<570;
  const profile=width>=780&&height>=560?'full':width>height&&height<560?'landscape':'portrait';
  this.root.dataset.compact=String(compact);
  this.root.dataset.slotPriority=profile;
  // The six reels keep a 6:5 board; `inset` is the frame padding and border around it.
  let pad:number,gap:number,head:number,inset:number,side=0,rail=0,header=0,hud=0,message=0,console=0;
  let board:number,contentWidth:number,contentHeight:number;
  if(profile==='full'){
   pad=16;gap=14;head=36;inset=14;message=64;rail=Math.min(288,Math.max(244,width*.24));
   const vertical=12;
   board=Math.min(width-pad*2-rail-gap-inset,(height-pad*2-message-vertical-head-inset)*1.2);
   contentWidth=board+inset+gap+rail;
   contentHeight=Math.max(head+board/1.2+inset+vertical+message,Math.min(height-pad*2,600));
  }else if(profile==='portrait'){
   pad=compact?8:12;gap=compact?6:10;head=compact?22:28;inset=12;
   header=compact?0:40;hud=compact?58:76;message=compact?48:56;console=compact?150:164;
   const rows=compact?4:5;
   board=Math.min(width-pad*2-inset,(height-pad*2-header-hud-message-console-gap*rows-head-inset)*1.2);
   contentWidth=width-pad*2;contentHeight=height-pad*2;
  }else{
   pad=8;gap=10;head=22;inset=10;side=width<700?100:140;rail=width<700?184:250;
   board=Math.min(width-pad*2-side-rail-gap*2-inset,(height-pad*2-head-inset)*1.2);
   contentWidth=side+board+inset+rail+gap*2;contentHeight=height-pad*2;
  }
  const frame=board+inset,stage=head+board/1.2+inset;
  for(const [name,value]of Object.entries({pad,gap,head,side,rail,header,hud,message,console,frame,stage,width:contentWidth,height:contentHeight})){
   this.root.style.setProperty('--nr-layout-'+name,Math.max(0,value).toFixed(3)+'px');
  }
 }
 destroy() { this.observer.disconnect(); }
}
