export const CAT_SIDE_CELS=12;
export function catSideCel(phase:number) {return Math.min(CAT_SIDE_CELS-1,Math.floor((phase-Math.floor(phase))*CAT_SIDE_CELS+1e-9));}
export const CAT_SIDE_SCALE = .28;
export const CAT_SIDE_STRIDE = 32;
export const CAT_SIDE_STANCE = .62;
export type CatSide = 'left' | 'right';
export type GaitPoint = { x:number; y:number };
export type CatLegName = 'near-hind' | 'near-front' | 'far-hind' | 'far-front';
export const CAT_CONTACTS: Record<CatLegName,number> = {'near-hind':0,'near-front':.25,'far-hind':.5,'far-front':.75};
const smooth=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};

/** Hips and shoulders take turns bearing weight; the neck steadies the head. */
export function catBodyMotion(phase:number) {
  const hip=3*Math.cos(4*Math.PI*phase);
  const shoulder=5*Math.cos(4*Math.PI*(phase-.25));
  return {hip,shoulder,head:shoulder*.2,tail:hip*.65+Math.sin(2*Math.PI*(phase-.12))*.8};
}

export function catPaw(phase:number,leg:CatLegName) {
  const t=((phase-CAT_CONTACTS[leg])%1+1)%1,hind=leg.endsWith('hind');
  const reach=CAT_SIDE_STRIDE*CAT_SIDE_STANCE/CAT_SIDE_SCALE;
  const maxRoll=hind?.10:.42;
  if(t<CAT_SIDE_STANCE)return {
    x:reach*(.5-t/CAT_SIDE_STANCE),lift:0,swing:0,planted:true,
    roll:maxRoll*smooth((t-(CAT_SIDE_STANCE-.12))/.12),
  };
  const swing=(t-CAT_SIDE_STANCE)/(1-CAT_SIDE_STANCE),arc=Math.sin(Math.PI*swing)**2;
  const tangent=-(1-CAT_SIDE_STANCE)/CAT_SIDE_STANCE;
  const returnPhase=-2*swing**3+3*swing**2+tangent*(2*swing**3-3*swing**2+swing);
  return {x:reach*(returnPhase-.5),lift:(hind?9:13)*arc,swing,planted:false,roll:maxRoll*(1-smooth(swing))+(hind?.06:.34)*arc};
}

function joint(root:GaitPoint,end:GaitPoint,upper:number,lower:number,bend:number):GaitPoint {
  const dx=end.x-root.x,dy=end.y-root.y,distance=Math.hypot(dx,dy);
  const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
  const across=Math.sqrt(Math.max(0,upper*upper-along*along));
  return {x:root.x+dx/distance*along-dy/distance*across*bend,y:root.y+dy/distance*along+dx/distance*across*bend};
}

export function catSidePose(phase:number,side:CatSide='right') {
  const ground=side==='right'?166:160,body=catBodyMotion(phase),heightOffset=ground-166;
  return (['far-hind','far-front','near-hind','near-front'] as const).map(name=>{
    const hind=name.endsWith('hind'),far=name.startsWith('far'),paw=catPaw(phase,name);
    const root={x:(hind?52:133)+(far?5:0),y:(hind?101+body.hip:100+body.shoulder)+heightOffset};
    const foot={x:root.x+paw.x,y:ground-paw.lift};
    // The toe stays planted as the heel peels off, so the wrist follows the paw roll.
    const ankle={x:foot.x+14-14*Math.cos(paw.roll)+10*Math.sin(paw.roll),y:foot.y-14*Math.sin(paw.roll)-10*Math.cos(paw.roll)};
    const tuck=Math.sin(Math.PI*paw.swing)**2;
    const hock=hind?{x:ankle.x-14+4*tuck,y:ankle.y-18-2*tuck}:ankle;
    const knee=joint(root,hock,hind?29:30,hind?34:33,hind?-1:1);
    return {name,hind,far,root,knee,hock,ankle,foot,planted:paw.planted,swing:paw.swing,roll:paw.roll};
  });
}
