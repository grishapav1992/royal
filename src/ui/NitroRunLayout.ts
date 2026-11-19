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
  const compact=height<570;
  const profile=width>height&&height<620?'landscape':width>=780&&height>=620?'full':'portrait';
  this.root.dataset.compact=String(compact);
  this.root.dataset.slotPriority=profile;
  let pad:number,side=0,frame:number,stage:number,contentWidth:number,contentHeight:number;
  let header:number,message:number,controls:number,hud=0,gap:number,inset:number;
  if(profile==='full'){
   pad=12;side=Math.min(176,Math.max(148,width*.16));header=62;message=40;controls=96;gap=10;inset=14;
   const stageBudget=height-pad*2-message-controls-gap;
   frame=Math.min(width-pad*2-side-12,(stageBudget-28-inset)*1.2+inset);
   stage=28+(frame-inset)/1.2+inset;
   contentWidth=side+12+frame;contentHeight=stage+gap+message+controls;
  }else if(profile==='portrait'){
   pad=compact?8:10;header=compact?30:44;message=compact?36:42;controls=compact?114:122;
   hud=compact?56:78;gap=compact?6:8;inset=compact?10:12;
   const title=compact?18:22;
   const frameBudget=height-pad*2-header-message-controls-gap*2-hud-gap-title;
   frame=Math.min(width-pad*2,(frameBudget-inset)*1.2+inset);
   stage=title+(frame-inset)/1.2+inset;
   contentWidth=width-pad*2;contentHeight=header+hud+gap+stage+message+controls+gap*2;
  }else{
   pad=8;side=94;header=30;message=height<290?40:48;gap=6;inset=10;
   const frameBudget=height-pad*2-header-gap-20;
   frame=Math.min(width-pad*2-182-14-side-12,(frameBudget-inset)*1.2+inset);
   stage=20+(frame-inset)/1.2+inset;
   contentWidth=side+12+frame+14+182;contentHeight=header+gap+stage;
   controls=contentHeight-message;
  }
  for(const [name,value]of Object.entries({pad,side,frame,stage,width:contentWidth,height:contentHeight,header,message,controls,hud,gap})){
   this.root.style.setProperty('--nr-layout-'+name,Math.max(0,value).toFixed(3)+'px');
  }
 }
 destroy() { this.observer.disconnect(); }
}
