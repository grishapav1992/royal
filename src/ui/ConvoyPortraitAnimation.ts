import {type ConvoyLookId} from '../shared/convoyWardrobe';

type Anchor=readonly [x:number,y:number,scale:number];
type Geometry={columns:readonly [number,number,number,number];row:number;waist:number;anchors:readonly Anchor[]};
const FRAME_MS:Record<ConvoyLookId,number>={survivor:240,recon:230,medic:210,pilot:240,urban:260,commander:210};
// The artwork has unequal gutters. Measured belt anchors keep the torso fixed while arms gesture.
const GEOMETRY:Record<ConvoyLookId,Geometry>={
  survivor:{columns:[100,450,800,1150],row:688,waist:285,anchors:[[300,285,1],[652,285,1],[995,285,1],[302,944,.92],[652,946,.92],[993,946,.92]]},
  recon:{columns:[20,420,820,1254],row:626,waist:255,anchors:[[250,255,1],[652,255,.98],[1056,255,1],[252,881,1.02],[654,881,1],[1074,881,1]]},
  medic:{columns:[100,450,800,1190],row:636,waist:255,anchors:[[305,255,1],[644,255,.98],[1003,255,1],[307,879,1.02],[646,879,1.02],[1005,879,1.02]]},
  pilot:{columns:[20,420,820,1254],row:624,waist:255,anchors:[[265,255,1],[654,255,1],[1047,255,1],[265,883,1],[656,883,1],[1047,883,.98]]},
  urban:{columns:[90,450,820,1220],row:631,waist:260,anchors:[[280,260,1],[641,260,1],[1012,260,1],[274,885,1.02],[649,885,1.02],[1020,885,1.02]]},
  commander:{columns:[20,420,820,1254],row:627,waist:250,anchors:[[250,250,1],[642,250,1],[1043,250,1.02],[254,877,1],[642,877,1],[1033,877,1]]},
};

/** Aligned poses blend on a continuous clock. Game phases never relocate or restart the portrait. */
export class ConvoyPortraitAnimation{
  private canvas:HTMLCanvasElement;
  private context:CanvasRenderingContext2D|null;
  private image?:HTMLImageElement;
  private loading?:HTMLImageElement;
  private look?:ConvoyLookId;
  private epoch=0;
  private timer?:ReturnType<typeof setTimeout>;
  private frame=0;
  private drawn='';
  private elapsed=0;
  private previous?:number;
  private paintedAt?:number;
  private stopped=true;
  private disposed=false;
  constructor(private root:HTMLElement){
    this.canvas=root.querySelector<HTMLCanvasElement>('[data-cv-frames]')!;
    this.context=this.canvas.getContext('2d');
  }
  choose(look:ConvoyLookId,retry=false){
    if(this.disposed||!this.context||this.look===look&&!retry)return;
    this.cancelLoad();this.stop();this.look=look;this.image=undefined;this.drawn='';this.elapsed=0;
    this.root.dataset.heroAtlas='loading';this.root.dataset.heroSprite='false';
    const epoch=++this.epoch,image=new Image();this.loading=image;
    const fail=()=>{if(this.disposed||epoch!==this.epoch)return;this.epoch++;this.cancelLoad();this.root.dataset.heroAtlas='fallback';};
    this.timer=setTimeout(fail,15000);image.onerror=fail;
    image.onload=()=>{void image.decode().then(()=>{
      if(this.disposed||epoch!==this.epoch)return;
      if(image.naturalWidth<300||Math.abs(image.naturalWidth/image.naturalHeight-1)>.02){fail();return;}
      clearTimeout(this.timer);image.onload=image.onerror=null;this.loading=undefined;this.image=image;
      this.root.dataset.heroAtlas='ready';this.paint(0,0,0);this.showFrame();this.resume();
    },fail);};
    image.src=`/assets/last-convoy/v3/${look}-gesture.webp`;
  }
  update(_motion:string,stopped:boolean){
    if(this.disposed)return;
    this.stopped=stopped;
    if(stopped)this.stop();
    this.showFrame();if(!stopped)this.resume();
  }
  private showFrame(){
    // Pausing holds the current pose. Only reduced motion or unavailable artwork uses the poster.
    this.root.dataset.heroSprite=String(!!this.image&&this.root.dataset.reducedMotion!=='true');
  }
  private resume(){
    if(this.disposed||this.stopped||!this.image||!this.context)return;
    this.showFrame();
    if(!this.frame){this.previous=undefined;this.paintedAt=undefined;this.frame=requestAnimationFrame(this.tick);}
  }
  private tick=(now:number)=>{
    this.frame=0;
    if(this.disposed||this.stopped||!this.image||!this.look)return;
    if(this.previous!==undefined)this.elapsed+=Math.min(80,Math.max(0,now-this.previous));
    this.previous=now;
    if(this.paintedAt===undefined||now-this.paintedAt>=32){
      const duration=FRAME_MS[this.look],time=this.elapsed%(6*duration+2800),step=Math.floor(time/duration);
      if(step<6){const t=(time%duration)/duration;this.paint(step,(step+1)%6,t*t*(3-2*t));}
      else this.paint(0,0,0);
      this.paintedAt=now;
    }
    this.frame=requestAnimationFrame(this.tick);
  };
  private paint(from:number,to:number,blend:number){
    if(!this.context||!this.image||!this.look)return;
    const key=`${from}:${to}:${Math.round(blend*120)}`;if(this.drawn===key)return;
    const context=this.context,geometry=GEOMETRY[this.look],ratio=this.image.naturalWidth/1254;
    context.clearRect(0,0,512,768);
    // Additive premultiplied blending keeps overlapping opaque pixels opaque throughout the dissolve.
    context.globalCompositeOperation='lighter';
    const draw=(frame:number,alpha:number)=>{
      if(alpha<=0)return;
      const column=frame%3,left=geometry.columns[column],top=frame<3?0:geometry.row;
      const width=geometry.columns[column+1]-left,height=frame<3?geometry.row:1254-top;
      const [x,y,scale]=geometry.anchors[frame],factor=512/418/scale;
      context.globalAlpha=alpha;
      context.drawImage(this.image!,left*ratio,top*ratio,width*ratio,height*ratio,
        256+(left-x)*factor,geometry.waist*(768/627)+(top-y)*factor,width*factor,height*factor);
    };
    draw(from,1-blend);draw(to,blend);
    context.globalAlpha=1;context.globalCompositeOperation='source-over';this.drawn=key;
    this.root.dataset.heroFrame=String(from);this.root.dataset.heroBlend=blend.toFixed(3);
  }
  private stop(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.previous=undefined;this.paintedAt=undefined;}
  private cancelLoad(){clearTimeout(this.timer);if(this.loading){this.loading.onload=this.loading.onerror=null;this.loading.removeAttribute('src');this.loading=undefined;}}
  destroy(){if(this.disposed)return;this.disposed=true;this.epoch++;this.cancelLoad();this.stop();this.image=undefined;}
}
