import {extractSpriteFrames} from '../../src/ui/crLeoSprites';
import type {JackieCostume} from '../../src/shared/jackieChan';
import {OPPONENTS,type OpponentId} from './JackieOpponents';

/** One drawn pose. Distances are in hero heights; `front` points where the actor looks. */
export type Frame={img:HTMLCanvasElement;k:number;ax:number;w:number;h:number;native:1|-1;tip:{dx:number;dy:number};front:(dy:number)=>number};
export type Sheet=Record<string,Frame>;
export type Pictures=ReadonlyMap<string,HTMLImageElement>;
const ROOT='/assets/jackie-chan/';
export const artUrl=(name:string)=>ROOT+name+'.webp';
type Raw={frames:{img:HTMLCanvasElement;ax:number}[];unit:number;height:number};
const raws=new WeakMap<HTMLImageElement,Raw>();
const sheets=new WeakMap<HTMLImageElement,Sheet>();
function raw(image:HTMLImageElement,kind:'base'|'furniture'|'combat'|'props'):Raw{
  const cached=raws.get(image);if(cached)return cached;
  const cell=image.naturalWidth/4,furniture=kind==='furniture';
  const frames=extractSpriteFrames(image,4,2,false,undefined,furniture?2:1).map(f=>({img:f.image,ax:cell*((furniture?.4:.5)-f.x)}));
  const body=kind==='combat'?[0,1,4,5,6]:furniture?[1,2,3,7]:[0,2,3,4,6,7];
  const value={frames,unit:Math.sqrt(image.naturalWidth*image.naturalHeight/8),height:Math.max(...body.map(i=>frames[i].img.height))};
  raws.set(image,value);return value;
}
/** Finds the striking point and the front outline from the drawing itself. */
function measure(img:HTMLCanvasElement,k:number,ax:number,native:1|-1,low=false):Frame{
  const w=img.width,h=img.height,data=img.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,w,h).data;
  const bins=48,fronts=new Float32Array(bins).fill(-9);let best=-1e9,sum=0,n=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(data[(y*w+x)*4+3]<150)continue;
    const reach=(x-ax)*native,bin=Math.min(bins-1,Math.floor((h-y)/h*bins));
    if(reach>fronts[bin])fronts[bin]=reach;
    // A fist or a raised foot strikes; the front foot of the stance does not.
    if(!low&&y>h*.62)continue;
    if(reach>best+3){best=reach;sum=y;n=1;}else if(reach>best-4){if(reach>best)best=reach;sum+=y;n++;}
  }
  const height=h*k;
  return {img,k,ax,w,h,native,tip:{dx:best*k,dy:(h-sum/Math.max(1,n))*k},front:dy=>{
    const bin=Math.max(0,Math.min(bins-1,Math.floor(dy/height*bins)));let value=-9;
    for(let i=Math.max(0,bin-2);i<=Math.min(bins-1,bin+2);i++)value=Math.max(value,fronts[i]);
    return value<-8?.1:value*k;
  }};
}
/** All three atlases of a costume share the base body's drawing scale. */
export function heroSheet(pictures:Pictures,id:JackieCostume):Sheet{
  const image=pictures.get(artUrl(id))!,cached=sheets.get(image);if(cached)return cached;
  const base=raw(image,'base'),out:Sheet={};
  for(const [letter,part] of [['b',base],['f',raw(pictures.get(artUrl(id+'-furniture'))!,'furniture')],['c',raw(pictures.get(artUrl(id+'-combat'))!,'combat')]] as const){
    const k=base.unit/(base.height*part.unit);
    part.frames.forEach((frame,i)=>{out[letter+i]=measure(frame.img,k,frame.ax,1,letter==='c'&&i===2||letter==='f'&&i===4);});
  }
  sheets.set(image,out);return out;
}
/** The same work in three steps, with display frames between them. */
export async function prepareHero(pictures:Pictures,id:JackieCostume,frame:()=>Promise<unknown>){
  if(sheets.has(pictures.get(artUrl(id))!))return;
  for(const [suffix,kind] of [['','base'],['-furniture','furniture'],['-combat','combat']] as const){raw(pictures.get(artUrl(id+suffix))!,kind);await frame();}
  if(pictures.get(artUrl(id)))heroSheet(pictures,id);
}
export function foeSheet(pictures:Pictures,id:OpponentId):Sheet{
  const image=pictures.get(OPPONENTS[id].asset)!,cached=sheets.get(image);if(cached)return cached;
  const part=raw(image,'base'),k=.95*OPPONENTS[id].scale/part.height,out:Sheet={};
  part.frames.forEach((frame,i)=>{out['b'+i]=measure(frame.img,k,frame.ax,-1);});
  sheets.set(image,out);return out;
}
const PROP_HEIGHT=[.56,.3,.36,.26,.44,.46,.5,.3];
export function propSheet(pictures:Pictures):Sheet{
  const image=pictures.get(artUrl('props'))!,cached=sheets.get(image);if(cached)return cached;
  const out:Sheet={};
  raw(image,'props').frames.forEach(({img},i)=>{const k=PROP_HEIGHT[i]/img.height;out['p'+i]={img,k,ax:img.width/2,w:img.width,h:img.height,native:1,tip:{dx:img.width*k/2,dy:.1},front:()=>img.width*k/2};});
  sheets.set(image,out);return out;
}
