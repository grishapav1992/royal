/** Original modal and noise samples. The seed is independent of every game draw. */
export type RouletteCue='chip'|'chip-alt'|'bet'|'start'|'tap'|'landing'|'settle'|'win'|'straight'|'wheel'|'roll';
export type RouletteSample={data:Float32Array;peakSeconds:number;loopStart:number};
function random(seed:number){let state=seed>>>0;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296*2-1;};}
function seal(data:Float32Array,rate:number,peak=.7,loop=false):RouletteSample{
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
    const attack=1-Math.exp(-t/.0017),env=attack*Math.exp(-t/(soft?.026:.037));
    let modes=0;frequencies.forEach((f,j)=>{modes+=Math.sin(2*Math.PI*f*t)*(.48/(1+j*1.8))*Math.exp(-t/(.045/(1+j*.55)));});
    data[i]=attack*modes+(low-body)*env*.8+body*attack*Math.exp(-t/.012)*.75;
  }
  return seal(data,rate,.68);
}
function chime(rate:number,full:boolean){
  const data=new Float32Array(Math.ceil(rate*(full?.94:.72))),notes=full?[523.251,659.255,783.991,1046.502]:[659.255,987.767];
  for(let j=0;j<notes.length;j++){
    const delay=j*(full?.085:.11),f=notes[j],gain=.5/(1+j*.85);
    for(let i=Math.ceil(delay*rate);i<data.length;i++){
      const t=i/rate-delay,attack=1-Math.exp(-t/.004),tail=Math.exp(-t/.16);
      data[i]+=gain*attack*tail*(Math.sin(2*Math.PI*f*t)+.13*Math.sin(2*Math.PI*f*2.756*t)*Math.exp(-t/.065)+.025*Math.sin(2*Math.PI*f*4.1*t)*Math.exp(-t/.03));
    }
  }
  return seal(data,rate,.64);
}
function texture(rate:number,ball:boolean){
  const seconds=ball?.73:1.07,data=new Float32Array(Math.ceil(rate*seconds)),rng=random(ball?0x49a713:0x21b7c9);let low=0,slow=0,body=0,grain=0,next=0;
  for(let i=0;i<data.length;i++){
    const t=i/rate,n=rng();low+=(ball?.28:.08)*(n-low);slow+=.018*(n-slow);body+=.006*(n-body);
    if(ball&&i>=next){grain=.55+.2*rng();next=i+Math.round(rate*(.009+.003*(rng()+1)/2));}
    grain*=Math.exp(-1/(rate*.0025));
    data[i]=ball?((low-slow)*.46+(low-slow)*grain*.6):body*.8+(low-slow)*.13+Math.sin(t*2*Math.PI*81)*.018;
  }
  return seal(data,rate,ball?.48:.42,true);
}
export function roulettePcm(rate:number):Record<RouletteCue,RouletteSample>{
  if(!Number.isFinite(rate)||rate<8000||rate>192000)throw Error('Invalid roulette audio sample rate');
  const start=new Float32Array(Math.ceil(rate*.22)),rng=random(0x843191);let low=0;
  for(let i=0;i<start.length;i++){const t=i/start.length;low+=.1*(rng()-low);start[i]=low*Math.sin(Math.PI*t)**2;}
  return{chip:clink(rate,.13,[1080,1940,2980],0x729381),'chip-alt':clink(rate,.14,[1010,1820,2810],0x849103),
    bet:clink(rate,.105,[470,960,1690],0x317912,true),start:seal(start,rate,.45),tap:clink(rate,.09,[690,1330,2470],0x551217,true),
    landing:clink(rate,.16,[390,830,1470],0x772193),settle:clink(rate,.11,[310,650,1160],0x119837,true),
    win:chime(rate,false),straight:chime(rate,true),wheel:texture(rate,false),roll:texture(rate,true)};
}
