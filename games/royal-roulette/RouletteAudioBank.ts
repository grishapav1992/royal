/** Original modal and noise samples. The seed is independent of every game draw. */
export type RouletteCue='chip'|'chip-alt'|'bet'|'start'|'tap'|'landing'|'settle'|'win'|'straight'|'wheel'|'roll';
export type RouletteSample={data:Float32Array;peakSeconds:number;loopStart:number};
function random(seed:number){let state=seed>>>0;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296*2-1;};}
function seal(data:Float32Array,rate:number,peak=.7,loop=false):RouletteSample{
  // A rate-independent low pass rounds the ceramic transients before normalization.
  const alpha=1-Math.exp(-2*Math.PI*2800/rate);let rounded=0;
  for(let i=0;i<data.length;i++){rounded+=alpha*(data[i]-rounded);data[i]=rounded;}
  const fade=Math.round(rate*.03);
  if(loop){
    for(let i=0;i<fade;i++){const t=(i+1)/fade,w=t*t*(3-2*t);data[data.length-fade+i]=data[data.length-fade+i]*(1-w)+data[i]*w;}
  }else{
    const edge=Math.min(Math.round(rate*.006),Math.floor(data.length/4));
    for(let i=0;i<edge;i++){const w=(i/edge)**2;data[i]*=w;data[data.length-1-i]*=w;}
  }
  let max=0,at=0;for(let i=0;i<data.length;i++)if(Math.abs(data[i])>max){max=Math.abs(data[i]);at=i;}
  const gain=max?peak/max:0;for(let i=0;i<data.length;i++)data[i]*=gain;
  return{data,peakSeconds:at/rate,loopStart:loop?fade/rate:0};
}
function clink(rate:number,seconds:number,frequencies:number[],seed:number,soft=false){
  const data=new Float32Array(Math.ceil(rate*seconds)),rng=random(seed);let low=0,body=0;
  for(let i=0;i<data.length;i++){
    const t=i/rate,n=rng();low+=.23*(n-low);body+=.055*(n-body);
    const attack=1-Math.exp(-t/(soft?.0035:.0028)),env=attack*Math.exp(-t/(soft?.032:.042));
    let modes=0;frequencies.forEach((f,j)=>{modes+=Math.sin(2*Math.PI*f*t)*(.48/(1+j*1.8))*Math.exp(-t/(.045/(1+j*.55)));});
    data[i]=attack*modes+(low-body)*env*.32+body*attack*Math.exp(-t/.019)*.9;
  }
  return seal(data,rate,.68);
}
function chime(rate:number,full:boolean){
  const data=new Float32Array(Math.ceil(rate*(full?.94:.72))),notes=full?[391.995,493.883,587.33,783.991]:[493.883,739.989];
  for(let j=0;j<notes.length;j++){
    const delay=j*(full?.085:.11),f=notes[j],gain=.5/(1+j*.85);
    for(let i=Math.ceil(delay*rate);i<data.length;i++){
      const t=i/rate-delay,attack=1-Math.exp(-t/.009),tail=Math.exp(-t/.18);
      data[i]+=gain*attack*tail*(Math.sin(2*Math.PI*f*t)+.065*Math.sin(2*Math.PI*f*2*t)*Math.exp(-t/.065)+.012*Math.sin(2*Math.PI*f*3*t)*Math.exp(-t/.03));
    }
  }
  return seal(data,rate,.64);
}
function texture(rate:number,ball:boolean){
  const seconds=ball?1.31:1.79,data=new Float32Array(Math.ceil(rate*seconds)),rng=random(ball?0x49a713:0x21b7c9);
  const a=1-Math.exp(-2*Math.PI*(ball?950:320)/rate),b=1-Math.exp(-2*Math.PI*90/rate);
  let low=0,body=0;
  for(let i=0;i<data.length;i++){
    const t=i/rate,n=rng();low+=a*(n-low);body+=b*(n-body);
    // Smooth ceramic grain and bearing rumble replace a bright, pulsed hiss.
    const grain=.82+.1*Math.sin(2*Math.PI*31*t)+.08*Math.sin(2*Math.PI*47*t);
    data[i]=ball?(low-body)*grain*.55+body*.16:body*.75+(low-body)*.14+Math.sin(t*2*Math.PI*61)*.025;
  }
  return seal(data,rate,ball?.48:.42,true);
}
export function roulettePcm(rate:number):Record<RouletteCue,RouletteSample>{
  if(!Number.isFinite(rate)||rate<8000||rate>192000)throw Error('Invalid roulette audio sample rate');
  const start=new Float32Array(Math.ceil(rate*.22)),rng=random(0x843191);let low=0;
  for(let i=0;i<start.length;i++){const t=i/start.length;low+=.1*(rng()-low);start[i]=low*Math.sin(Math.PI*t)**2;}
  return{chip:clink(rate,.13,[760,1420,2210],0x729381),'chip-alt':clink(rate,.14,[720,1340,2090],0x849103),
    bet:clink(rate,.105,[370,790,1260],0x317912,true),start:seal(start,rate,.45),tap:clink(rate,.09,[520,1040,1680],0x551217,true),
    landing:clink(rate,.16,[320,680,1120],0x772193),settle:clink(rate,.11,[270,540,920],0x119837,true),
    win:chime(rate,false),straight:chime(rate,true),wheel:texture(rate,false),roll:texture(rate,true)};
}
