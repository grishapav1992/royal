/** Loads the existing game drawings and measures them. No new artwork. */
import {extractSpriteFrames} from '../../../../src/ui/crLeoSprites';
export type Costume='master'|'sailor'|'police'|'hawk'|'rush'|'whoami'|'tuxedo'|'mentor';
export type Location='restaurant'|'harbor'|'market';
export type FoeId='street'|'agile'|'bruiser'|'enforcer'|'master';
export const FOES:Record<FoeId,{file:string;scale:number;weight:number;ru:string}>={
  street:{file:'foes',scale:1,weight:1,ru:'Уличный боец'},
  agile:{file:'foe-agile',scale:.92,weight:.85,ru:'Ловкий боец'},
  bruiser:{file:'foe-bruiser',scale:1.08,weight:1.6,ru:'Портовый громила'},
  enforcer:{file:'foe-enforcer',scale:1.02,weight:1.1,ru:'Телохранитель'},
  master:{file:'foe-master',scale:.91,weight:.9,ru:'Мастер кунг-фу'},
};
/** One drawn pose. Distances are in hero heights, `front` points where the actor looks. */
export type Frame={img:HTMLCanvasElement;k:number;ax:number;w:number;h:number;native:1|-1;tip:{dx:number;dy:number};front:(dy:number)=>number};
export type Sheet=Record<string,Frame>;
const base='assets/';
const pictures=new Map<string,Promise<HTMLImageElement>>();
export function picture(name:string){
  let p=pictures.get(name);
  if(!p){p=new Promise((yes,no)=>{const i=new Image();i.onload=()=>yes(i);i.onerror=()=>{pictures.delete(name);no(Error(name));};i.src=base+name+'.webp';});pictures.set(name,p);}
  return p;
}
function measure(img:HTMLCanvasElement,k:number,ax:number,native:1|-1,low=false):Frame{
  const w=img.width,h=img.height,data=img.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,w,h).data;
  const bins=48,fronts=new Float32Array(bins).fill(-9);let best=-1e9,sum=0,n=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(data[(y*w+x)*4+3]<150)continue;
    const f=(x-ax)*native;
    const bin=Math.min(bins-1,Math.floor((h-y)/h*bins));
    if(f>fronts[bin])fronts[bin]=f;
    // A fist or a raised foot strikes; the front foot of the stance does not.
    if(!low&&y>h*.62)continue;
    if(f>best+3){best=f;sum=y;n=1;}else if(f>best-4){if(f>best)best=f;sum+=y;n++;}
  }
  const H=h*k;
  return {img,k,ax,w,h,native,tip:{dx:best*k,dy:(h-sum/n)*k},front:(dy:number)=>{
    const b=Math.max(0,Math.min(bins-1,Math.floor(dy/H*bins)));
    let v=-9;for(let i=Math.max(0,b-2);i<=Math.min(bins-1,b+2);i++)v=Math.max(v,fronts[i]);
    return v<-8?.1:v*k;
  }};
}
type Raw={frames:{img:HTMLCanvasElement;ax:number}[];unit:number;height:number};
const raws=new Map<string,Promise<Raw>>();
function raw(name:string,kind:'base'|'furniture'|'combat'|'foe'|'props'){
  let p=raws.get(name);
  if(!p){p=picture(name).then(image=>{
    const cw=image.naturalWidth/4,furniture=kind==='furniture';
    const frames=extractSpriteFrames(image,4,2,false,undefined,furniture?2:1).map(f=>({img:f.image,ax:cw*((furniture?.4:.5)-f.x)}));
    const pick=kind==='combat'?[0,1,4,5,6]:furniture?[1,2,3,7]:[0,2,3,4,6,7];
    return {frames,unit:Math.sqrt(image.naturalWidth*image.naturalHeight/8),height:Math.max(...pick.map(i=>frames[i].img.height))};
  });raws.set(name,p);}
  return p;
}
export async function heroSheet(id:Costume):Promise<Sheet>{
  const [b,f,c]=await Promise.all([raw(id,'base'),raw(id+'-furniture','furniture'),raw(id+'-combat','combat')]);
  const out:Sheet={};
  for(const [letter,s] of [['b',b],['f',f],['c',c]] as const){const k=b.unit/(b.height*s.unit);s.frames.forEach((fr,i)=>out[letter+i]=measure(fr.img,k,fr.ax,1,letter==='c'&&i===2||letter==='f'&&i===4));}
  return out;
}
export async function foeSheet(id:FoeId):Promise<Sheet>{
  const s=await raw(FOES[id].file,'foe'),k=.95*FOES[id].scale/s.height,out:Sheet={};
  s.frames.forEach((fr,i)=>out['b'+i]=measure(fr.img,k,fr.ax,-1));return out;
}
const PROP_H=[.56,.3,.36,.26,.44,.46,.5,.3];
export async function propSheet():Promise<Sheet>{
  const s=await raw('props','props'),out:Sheet={};
  s.frames.forEach((fr,i)=>{const k=PROP_H[i]/fr.img.height;out['p'+i]={img:fr.img,k,ax:fr.img.width/2,w:fr.img.width,h:fr.img.height,native:1,tip:{dx:fr.img.width*k/2,dy:.1},front:()=>fr.img.width*k/2};});
  return out;
}
