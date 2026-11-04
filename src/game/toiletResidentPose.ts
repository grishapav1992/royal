export type ToiletResidentStage='idle'|'take-paper'|'tear-paper'|'wipe'|'settle';
type Point={x:number;y:number};
export const TOILET_RESIDENT_CYCLE_MS=12000;
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const smooth=(t:number)=>{const n=Math.max(0,Math.min(1,t));return n*n*(3-2*n);};

/** A quiet loop: take paper, tear it, wipe behind the shirt and rest again. */
export function toiletResidentPose(elapsedMs:number,reducedMotion=false){
  const time=reducedMotion?0:Math.max(0,elapsedMs)%TOILET_RESIDENT_CYCLE_MS/1000;
  let stage:ToiletResidentStage='idle',right:Point={x:66,y:79},left:Point={x:35,y:79},paper=false,behindShirt=false;
  if(time>=3&&time<4.5){
    stage='take-paper';const t=smooth((time-3)/1.5);right=mix(right,{x:84,y:60},t);paper=t>.68;
  }else if(time>=4.5&&time<5.4){
    stage='tear-paper';const t=smooth((time-4.5)/.9);right=mix({x:84,y:60},{x:61,y:68},t);left=mix(left,{x:47,y:69},t);paper=true;
  }else if(time>=5.4&&time<6.2){
    stage='wipe';const t=smooth((time-5.4)/.8);right=mix({x:61,y:68},{x:69,y:83},t);left=mix({x:47,y:69},left,t);paper=true;behindShirt=t>.45;
  }else if(time>=6.2&&time<8.2){
    stage='wipe';right={x:69+Math.sin((time-6.2)*Math.PI*3)*2.4,y:83+Math.sin((time-6.2)*Math.PI*3)*2};paper=true;behindShirt=true;
  }else if(time>=8.2&&time<9.4){
    stage='settle';const t=smooth((time-8.2)/1.2);right=mix({x:69,y:83},right,t);paper=t<.55;behindShirt=t<.55;
  }
  const lean=stage==='wipe'?1.5*Math.sin(Math.PI*Math.min(1,(time-5.4)/2.8)):0;
  return {stage,time,right,left,paper,behindShirt,lean,breath:reducedMotion?0:Math.sin(time*Math.PI*.5)*.45,blink:!reducedMotion&&(time%4.1)<.14};
}
export type ToiletResidentPose=ReturnType<typeof toiletResidentPose>;
