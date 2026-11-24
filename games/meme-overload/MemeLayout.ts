import {gameContentLayout} from '../../src/ui/GameLayoutPolicy';
export type MemeProfile='full'|'portrait'|'landscape';
/** Fits the desktop windows into the space the host leaves after its header and chat.
    The field depends on the window size only, so texts, wins and the virus mode never resize it. */
export class MemeLayout {
 private observer:ResizeObserver;private last?:MemeProfile;
 constructor(private root:HTMLElement,private changed:(profile:MemeProfile)=>void){
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(root);this.resize();
 }
 private resize(){
  const {width,height}=this.root.getBoundingClientRect();if(!width||!height)return;
  const profile:MemeProfile=gameContentLayout(width,height);
  const compact=profile==='full'?height<720:profile==='portrait'?height<700:height<300;
  let pad=10,gap=10,title=30,status=46,side=0,strip=0,bar=0,rail=0,board:number;
  const large=profile==='full'&&height>=1080&&width>=1600;
  if(profile==='full'){
   // Window borders 6, frame padding 12.
   bar=compact?76:large?112:84;if(compact){pad=8;gap=8;}if(large){pad=14;gap=14;title=40;status=62;}
   const least=Math.max(236,Math.min(281,width*.255));
   board=Math.min((height-bar-pad*2-title-status-18)*1.2,width-pad*2-gap-least-18);
   side=Math.min(Math.max(390,board*.42),width-pad*2-gap-board-18);
  }else if(profile==='portrait'){
   pad=6;gap=compact?5:8;title=compact?22:26;status=compact?50:84;strip=compact?36:96;bar=compact?122:202;
   const chrome=pad*2+gap*2+title+12;
   board=Math.min(width-pad*2-12,(height-chrome-status-strip-bar)*1.2);
   const spare=Math.max(0,height-chrome-status-strip-bar-board/1.2);
   if(!compact){strip+=Math.min(20,spare*.22);status+=Math.min(24,spare*.24);bar+=Math.min(44,spare*.42);}
  }else{
   pad=compact?5:6;gap=pad;title=compact?20:22;status=0;rail=width<700?164:236;
   const middle=width<700?104:190;
   board=Math.min(width-pad*2-gap*2-rail-middle-12,(height-pad*2-title-12)*1.2);
   side=width-pad*2-gap*2-rail-board-12;
  }
  board=Math.max(120,Math.floor(board));
  this.root.dataset.slotPriority=profile;this.root.dataset.compact=String(compact);this.root.dataset.large=String(large);this.root.dataset.tight=String(profile==='landscape'&&width<700);
  for(const [name,value] of Object.entries({pad,gap,title,status,side,strip,bar,rail,board}))this.root.style.setProperty('--mo-'+name,Math.max(0,value).toFixed(2)+'px');
  if(this.last!==profile){this.last=profile;this.changed(profile);}
 }
 destroy(){this.observer.disconnect();}
}
