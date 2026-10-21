import {type ConvoyLookId} from '../shared/convoyWardrobe';

type Pose=readonly [frame:number,holdMs:number];
type Geometry={columns:readonly [number,number,number,number];height:number;centres:readonly [number,number,number];poses:readonly Pose[]};
// Only complete poses from the upper row are used. Lower rows can crop the boots.
// Every pose in an outfit uses one scale and the same floor, without body morphing.
const GEOMETRY:Record<ConvoyLookId,Geometry>={
  survivor:{columns:[100,450,800,1150],height:688,centres:[300,652,995],poses:[[0,13000],[2,7000]]},
  recon:{columns:[20,420,820,1254],height:626,centres:[250,652,1056],poses:[[0,11000],[2,9000]]},
  medic:{columns:[100,450,800,1190],height:636,centres:[305,644,1003],poses:[[0,12000],[2,8000],[1,10000]]},
  pilot:{columns:[20,420,820,1254],height:624,centres:[265,654,1047],poses:[[0,13000],[2,9000],[1,8000]]},
  urban:{columns:[90,450,820,1220],height:631,centres:[280,641,1012],poses:[[0,12000],[2,11000],[1,9000]]},
  commander:{columns:[20,420,820,1254],height:627,centres:[250,642,1043],poses:[[0,14000],[2,9000],[1,10000]]},
};

/** Hold finished poses for seconds. Game phases never restart the portrait clock. */
export class ConvoyPortraitAnimation{
  private canvas:HTMLCanvasElement;
  private context:CanvasRenderingContext2D|null;
  private image?:HTMLImageElement;
  private loading?:HTMLImageElement;
  private look?:ConvoyLookId;
  private epoch=0;
  private loadTimer?:ReturnType<typeof setTimeout>;
  private poseTimer?:ReturnType<typeof setTimeout>;
  private startedAt?:number;
  private remaining=0;
  private pose=0;
  private scale=1;
  private centre=256;
  private stopped=true;
  private disposed=false;
  constructor(private root:HTMLElement){
    this.canvas=root.querySelector<HTMLCanvasElement>('[data-cv-frames]')!;
    this.canvas.width=512;this.canvas.height=1024;
    this.context=this.canvas.getContext('2d');
  }
  choose(look:ConvoyLookId,retry=false){
    if(this.disposed||!this.context||this.look===look&&!retry)return;
    this.cancelLoad();this.stop();this.look=look;this.image=undefined;this.pose=0;
    this.remaining=GEOMETRY[look].poses[0][1];
    this.root.dataset.heroAtlas='loading';this.root.dataset.heroSprite='false';
    const epoch=++this.epoch,image=new Image();this.loading=image;
    const fail=()=>{if(this.disposed||epoch!==this.epoch)return;this.epoch++;this.cancelLoad();this.root.dataset.heroAtlas='fallback';};
    this.loadTimer=setTimeout(fail,15000);image.onerror=fail;
    image.onload=()=>{void image.decode().then(()=>{
      if(this.disposed||epoch!==this.epoch)return;
      if(image.naturalWidth<300||Math.abs(image.naturalWidth/image.naturalHeight-1)>.02){fail();return;}
      clearTimeout(this.loadTimer);image.onload=image.onerror=null;this.loading=undefined;this.image=image;
      this.measure();this.root.dataset.heroAtlas='ready';this.paint();this.showFrame();this.resume();
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
    // Reduced motion and pausing hold the actual pose instead of changing artwork.
    this.root.dataset.heroSprite=String(!!this.image);
  }
  private resume(){
    if(this.disposed||this.stopped||!this.image||!this.context||this.poseTimer!==undefined)return;
    this.startedAt=performance.now();
    this.poseTimer=setTimeout(this.advance,Math.max(0,this.remaining));
  }
  private advance=()=>{
    this.poseTimer=undefined;this.startedAt=undefined;
    if(this.disposed||this.stopped||!this.image||!this.look)return;
    const poses=GEOMETRY[this.look].poses;
    this.pose=(this.pose+1)%poses.length;this.remaining=poses[this.pose][1];
    this.paint();this.resume();
  };
  private measure(){
    if(!this.image||!this.look)return;
    const geometry=GEOMETRY[this.look],canvas=document.createElement('canvas');
    canvas.width=1254;canvas.height=geometry.height;
    const context=canvas.getContext('2d')!;
    context.drawImage(this.image,0,0,1254,1254);
    const {data}=context.getImageData(0,0,1254,geometry.height);
    let left=0,right=0;
    for(const [frame] of geometry.poses){
      for(let y=0;y<geometry.height;y++)for(let x=geometry.columns[frame];x<geometry.columns[frame+1];x++){
        if(data[(y*1254+x)*4+3]>16){left=Math.min(left,x-geometry.centres[frame]);right=Math.max(right,x-geometry.centres[frame]);}
      }
    }
    // Fit the widest gesture once, so raising an arm cannot resize the body.
    this.scale=976/geometry.height;
    this.canvas.width=Math.ceil((right-left)*this.scale)+48;
    this.centre=24-left*this.scale;
  }
  private paint(){
    if(!this.context||!this.image||!this.look)return;
    const context=this.context,geometry=GEOMETRY[this.look],ratio=this.image.naturalWidth/1254;
    const [frame,hold]=geometry.poses[this.pose],left=geometry.columns[frame];
    const width=geometry.columns[frame+1]-left;
    context.clearRect(0,0,this.canvas.width,this.canvas.height);
    context.drawImage(this.image,left*ratio,0,width*ratio,geometry.height*ratio,
      this.centre+(left-geometry.centres[frame])*this.scale,1000-geometry.height*this.scale,
      width*this.scale,geometry.height*this.scale);
    this.root.dataset.heroFrame=String(frame);this.root.dataset.heroBlend='0.000';
    this.root.dataset.heroHold=String(hold);
  }
  private stop(){
    if(this.startedAt!==undefined)this.remaining=Math.max(0,this.remaining-(performance.now()-this.startedAt));
    clearTimeout(this.poseTimer);this.poseTimer=undefined;this.startedAt=undefined;
  }
  private cancelLoad(){clearTimeout(this.loadTimer);if(this.loading){this.loading.onload=this.loading.onerror=null;this.loading.removeAttribute('src');this.loading=undefined;}}
  destroy(){if(this.disposed)return;this.disposed=true;this.epoch++;this.cancelLoad();this.stop();this.image=undefined;}
}
