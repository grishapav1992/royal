import {routeProfiles} from './lastExitRoute';

const files:Record<string,string>={highway:'v1/highway.webp',coupe:'v1/coupe.webp',patrol:'v1/patrol.webp',explosion:'v1/explosion.webp',helicopter:'v2d/helicopter.png',props:'v2d/props.png',side:'v2d/coupe-side.png',yaw:'v2d/coupe-yaw.png',depthRoll:'v2d/coupe-depth-roll.png',plane:'v2d/cargo-plane.png',ram:'v2d/patrol-ram.png',routeProps:'v2d/route-props.png',...Object.fromEntries(routeProfiles.map(p=>['route-'+p.key,'v2d/route-'+p.key+'.png']))};
export type LastExitAssetState={status:'loading'|'ready'|'error';loaded:number;total:number};

/** Decode every route and ending before accepting a new run. */
export class LastExitAssets {
 private images=new Map<string,HTMLImageElement>();
 private pending=new Set<()=>void>();
 private generation=0;private disposed=false;
 private status:LastExitAssetState['status']='loading';
 get state():LastExitAssetState{return {status:this.status,loaded:this.images.size,total:Object.keys(files).length};}
 get ready(){return !this.disposed&&this.status==='ready';}
 get(name:string){return this.images.get(name);}
 async load(changed:(state:LastExitAssetState)=>void){
  if(this.disposed)return false;
  const generation=++this.generation;this.cancel();this.status='loading';changed(this.state);
  try{
   await Promise.all(Object.entries(files).map(([name,file])=>this.images.has(name)?Promise.resolve():new Promise<void>((resolve,reject)=>{
    const image=new Image();let settled=false,decoding=false;
    const finish=(error?:Error)=>{
     if(settled)return;settled=true;clearTimeout(timer);image.onload=null;image.onerror=null;this.pending.delete(cancel);
     if(error){image.removeAttribute('src');reject(error);return;}
     this.images.set(name,image);changed(this.state);resolve();
    };
    const cancel=()=>finish(Error('Image loading cancelled'));
    const timer=setTimeout(()=>finish(Error('Image loading timed out')),30000);
    this.pending.add(cancel);image.decoding='async';image.fetchPriority='high';
    image.onerror=()=>finish(Error('Image loading failed'));
    image.onload=async()=>{
     if(settled||decoding)return;decoding=true;
     try{
      await image.decode();
      if(settled||this.disposed||generation!==this.generation)return;
      if(!image.naturalWidth||!image.naturalHeight)throw Error('Empty image');
      finish();
     }catch{finish(Error('Image decoding failed'));}
    };
    image.src='/assets/last-exit/'+file;
   })));
   if(this.disposed||generation!==this.generation)return false;
   // Exercise the canvas image path before the first outcome uses its sprites.
   const warm=document.createElement('canvas');warm.width=warm.height=1;
   const context=warm.getContext('2d');if(!context)throw Error('Canvas 2D unavailable');
   for(const image of this.images.values())context.drawImage(image,0,0,1,1);
   this.status='ready';changed(this.state);return true;
  }catch{
   if(this.disposed||generation!==this.generation)return false;
   this.cancel();this.status='error';changed(this.state);return false;
  }
 }
 private cancel(){for(const cancel of [...this.pending])cancel();}
 destroy(){this.disposed=true;this.generation++;this.cancel();this.images.clear();}
}
