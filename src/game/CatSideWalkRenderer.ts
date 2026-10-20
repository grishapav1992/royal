import Phaser from 'phaser';
import frames from '../../public/assets/cat/walk-v3-frames.json';
import { CAT_SIDE_SCALE, CAT_SIDE_CELS, catSideCel, catBodyMotion, catSidePose, type CatSide, type GaitPoint } from './CatSideGait';
export const CAT_SIDE_PARTS_TEXTURE='zverochka-side-parts';
const WIDTH=300,HEIGHT=230,GROUND=195;
const smooth=(n:number)=>{const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t);};

/** Whole 2D poses are drawn once and reused; the walking cat has no exposed cutout joints. */
export class CatSideWalkRenderer {
  private image:Phaser.GameObjects.Image;
  private key:string;
  constructor(scene:Phaser.Scene,sourceKey:string) {
    this.key='cat-side-cels-'+scene.sys.settings.key;
    if(!scene.textures.exists(this.key)) {
      const source=scene.textures.get(sourceKey).getSourceImage() as HTMLImageElement;
      const parts=scene.textures.get(CAT_SIDE_PARTS_TEXTURE).getSourceImage() as HTMLImageElement;
      const atlas=scene.textures.createCanvas(this.key,WIDTH*CAT_SIDE_CELS,HEIGHT*2)!;
      for(const [row,side] of (['right','left'] as const).entries()) {
        const body=this.body(source,side);
        for(let cel=0;cel<CAT_SIDE_CELS;cel++) {
          const ctx=atlas.context;
          ctx.save();ctx.translate(cel*WIDTH,row*HEIGHT);ctx.beginPath();ctx.rect(0,0,WIDTH,HEIGHT);ctx.clip();
          this.paint(ctx,parts,body,side,cel/CAT_SIDE_CELS);ctx.restore();
          atlas.add(side+'-'+cel,0,cel*WIDTH,row*HEIGHT,WIDTH,HEIGHT);
        }
      }
      atlas.refresh();scene.events.once('shutdown',()=>scene.textures.remove(this.key));
    }
    this.image=scene.add.image(0,0,this.key,'right-0').setOrigin(.5,GROUND/HEIGHT).setScale(CAT_SIDE_SCALE).setName('cat-side-walk').setVisible(false);
  }
  private body(source:HTMLImageElement,side:CatSide) {
    const canvas=document.createElement('canvas');canvas.width=220;canvas.height=180;
    const ctx=canvas.getContext('2d')!,[l,t,r,b]=frames[side][0].bounds,w=r-l;
    ctx.beginPath();ctx.moveTo(-4,-4);ctx.lineTo(w+4,-4);ctx.lineTo(w+4,104);
    const belly=[[190,106],[172,110],[151,115],[133,114],[116,112],[96,110],[77,111],[58,110],[42,111],[25,108],[0,103]];
    for(const [x,y] of side==='right'?belly:belly.map(([x,y])=>[w-x,y]).reverse())ctx.lineTo(x,y);
    ctx.lineTo(-4,104);ctx.closePath();ctx.clip();ctx.drawImage(source,l,t,w,b-t,0,0,w,b-t);
    return canvas;
  }
  hide() {this.image.setVisible(false);}
  update(side:CatSide,phase:number,x:number,y:number,depth:number) {
    const cel=catSideCel(phase);
    this.image.setFrame(side+'-'+cel).setPosition(x,y).setDepth(depth).setVisible(true);
  }
  private paint(ctx:CanvasRenderingContext2D,parts:HTMLImageElement,body:HTMLCanvasElement,side:CatSide,phase:number) {
    const {bounds:[l,t,r],anchorX,groundY}=frames[side][0],legs=catSidePose(phase,side);
    ctx.save();ctx.translate(WIDTH/2-anchorX+l,GROUND-groundY+t);
    const drawLegs=(far:boolean)=>{
      ctx.save();if(side==='left'){ctx.translate(r-l,0);ctx.scale(-1,1);}
      for(const leg of legs.filter(leg=>leg.far===far))this.leg(ctx,parts,leg);
      ctx.restore();
    };
    drawLegs(true);
    ctx.save();ctx.globalCompositeOperation='source-atop';ctx.fillStyle='rgba(20,18,25,.18)';ctx.fillRect(-50,-50,350,300);ctx.restore();
    const motion=catBodyMotion(phase),w=r-l;
    for(let x=0;x<w;x+=2) {
      const u=side==='right'?x:w-x;
      let shift=motion.hip+(motion.shoulder-motion.hip)*smooth((u-52)/81);
      if(u<45)shift=motion.tail+(motion.hip-motion.tail)*smooth(u/45);
      if(u>145)shift=motion.shoulder+(motion.head-motion.shoulder)*smooth((u-145)/30);
      ctx.drawImage(body,x,0,2,180,x,shift,2.35,180);
    }
    drawLegs(false);ctx.restore();
  }
  private leg(ctx:CanvasRenderingContext2D,parts:HTMLImageElement,leg:ReturnType<typeof catSidePose>[number]) {
    const path=this.contour(leg);
    ctx.save();ctx.clip(path);
    const coat=ctx.createLinearGradient(0,leg.root.y,0,leg.ankle.y);
    coat.addColorStop(0,'#211d1b');coat.addColorStop(leg.hind?.48:.76,'#332b27');coat.addColorStop(leg.hind?.70:.90,'#ded8ce');coat.addColorStop(1,'#eae4da');
    ctx.fillStyle=coat;ctx.fillRect(leg.root.x-85,leg.root.y-25,170,110);
    // Fur detail fills a single continuous silhouette, rather than rotating visible pieces.
    ctx.globalCompositeOperation='soft-light';ctx.globalAlpha=.22;
    ctx.drawImage(parts,242,520,83,160,leg.root.x-65,leg.root.y-15,130,55);
    ctx.drawImage(parts,715,970,75,120,leg.root.x-65,leg.root.y+30,130,60);
    ctx.restore();
    ctx.save();ctx.strokeStyle='rgba(28,22,20,.5)';ctx.lineWidth=.8;ctx.stroke(path);ctx.restore();
    ctx.save();ctx.translate(leg.foot.x+14,leg.foot.y);ctx.rotate(leg.roll);
    ctx.drawImage(parts,192,1288,194,147,-21,-14,21,14);ctx.restore();
  }
  private contour(leg:ReturnType<typeof catSidePose>[number]) {
    const points:{x:number;y:number;r:number}[]=[];
    for(let i=0;i<=24;i++) {
      const t=i/24,s=1-t;
      const curve=(key:'x'|'y')=>leg.hind
        ?s**3*leg.root[key]+3*s*s*t*leg.knee[key]+3*s*t*t*leg.hock[key]+t**3*leg.ankle[key]
        :s*s*leg.root[key]+2*s*t*leg.knee[key]+t*t*leg.ankle[key];
      points.push({x:curve('x'),y:curve('y'),r:leg.hind?16*(1-t)**1.4+5.5*t:11*(1-t)+5.5*t});
    }
    const a:GaitPoint[]=[],b:GaitPoint[]=[];
    points.forEach((p,i)=>{
      const before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)],length=Math.hypot(after.x-before.x,after.y-before.y)||1;
      const nx=-(after.y-before.y)/length*p.r,ny=(after.x-before.x)/length*p.r;
      a.push({x:p.x+nx,y:p.y+ny});b.push({x:p.x-nx,y:p.y-ny});
    });
    const path=new Path2D();path.moveTo(a[0].x,a[0].y);
    for(const p of [...a.slice(1),...b.reverse()])path.lineTo(p.x,p.y);
    path.closePath();return path;
  }
}
