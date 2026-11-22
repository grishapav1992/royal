/** Fits the studio cabinet into the space the host leaves after its header and chat. */
export class GirlhubLayout {
 private observer: ResizeObserver;
 constructor(private root: HTMLElement) {
  this.observer = new ResizeObserver(() => this.resize());
  this.observer.observe(root);
  this.resize();
 }
 private resize() {
  const {width,height} = this.root.getBoundingClientRect();
  if(!width||!height)return;
  const profile=width>=780&&height>=560?'full':width>height&&height<560?'landscape':'portrait';
  const compact=profile==='full'?height<720:profile==='portrait'?height<700:height<330;
  this.root.dataset.slotPriority=profile;
  this.root.dataset.compact=String(compact);
  // The field keeps six reels by five rows. `insetX` and `insetY` are the viewfinder padding and border.
  let pad:number,gap:number,head:number,insetX:number,insetY:number,model=0,hud=0,strip=0,status=0,dock=0,side=0,rail=0,board:number;
  if(profile==='full'){
   pad=16;gap=14;head=compact?32:38;insetX=26;insetY=14;dock=compact?88:100;status=compact?56:64;
   model=Math.round(Math.min(260,Math.max(176,width*.19)));hud=Math.round(Math.min(236,Math.max(184,width*.18)));
   board=Math.min(width-pad*2-model-hud-gap*2-insetX,(height-pad*2-dock-status-12-head-insetY)*1.2,900);
  }else if(profile==='portrait'){
   pad=compact?8:12;gap=compact?6:8;head=compact?26:30;insetX=18;insetY=10;
   strip=compact?52:60;hud=compact?0:52;status=compact?48:56;dock=compact?176:196;
   const gaps=compact?4:5;
   board=Math.min(width-pad*2-insetX,(height-pad*2-strip-hud-status-dock-gap*gaps-head-insetY)*1.2);
  }else{
   pad=8;gap=8;head=24;insetX=14;insetY=8;side=width<700?148:196;rail=width<700?176:224;
   board=Math.min(width-pad*2-side-rail-gap*2-insetX,(height-pad*2-head-insetY)*1.2);
  }
  board=Math.max(120,Math.floor(board));
  const frame=board+insetX,stage=head+board/1.2+insetY;
  for(const [name,value] of Object.entries({pad,gap,head,model,hud,strip,status,dock,side,rail,board,frame,stage})){
   this.root.style.setProperty('--ag-layout-'+name,Math.max(0,value).toFixed(2)+'px');
  }
 }
 destroy() { this.observer.disconnect(); }
}
