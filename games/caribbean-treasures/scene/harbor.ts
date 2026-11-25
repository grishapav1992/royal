/** The existing harbour picture, brought to life by displacement only. Nothing is repainted. */
import {loadImage,program,texture} from './gl';
import {MEDIA} from './media';
const FRAG=`precision highp float;varying vec2 v;
uniform sampler2D pic,mask;uniform vec2 size;uniform vec3 place;uniform float t,sunset,storm,bolt,shot,calm;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float spot(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return 1.-smoothstep(.55,1.,length(q));}
float box(vec2 p,vec2 a,vec2 b,vec2 s){vec2 q=smoothstep(a-s,a+s,p)*(1.-smoothstep(b-s,b+s,p));return q.x*q.y;}
vec2 turn(vec2 p,vec2 c,float a){vec2 q=(p-c)*vec2(1.7778,1.);q=mat2(cos(a),-sin(a),sin(a),cos(a))*q;return c+q/vec2(1.7778,1.);}
void main(){
 vec2 p=(v*size-place.xy)/(place.z*vec2(1600.,900.));vec2 base=p;float sway=calm*(1.+storm*1.5);
 if(p.y>1.)p.y=max(.85,2.-p.y);
 p=clamp(p,0.,1.);
 vec4 m=texture2D(mask,p);
 float sky=m.g*smoothstep(.27,.34,p.x)*(1.-smoothstep(.2,.31,p.y));
 float depth=clamp((p.y-.455)/.38,0.,1.);
 vec2 q=p;
 // galleon and the second ship ride the swell
 float s1=spot(p,vec2(.158,.29),vec2(.115,.25))*(1.-smoothstep(.455,.475,p.y));
 q=mix(q,turn(q+vec2(0.,.0035*sin(t*.9)*sway),vec2(.16,.47),.0105*sin(t*.72)*sway),s1);
 float s2=spot(p,vec2(.289,.40),vec2(.045,.11))*(1.-smoothstep(.455,.468,p.y));
 q=mix(q,turn(q+vec2(0.,.002*sin(t*1.1+1.)*sway),vec2(.289,.46),.012*sin(t*.83+2.)*sway),s2);
 float s3=spot(p,vec2(.39,.415),vec2(.025,.07));q=mix(q,turn(q,vec2(.39,.455),.012*sin(t*.7+4.)*sway),s3);
 // flags
 float fl=box(p,vec2(.142,.095),vec2(.182,.155),vec2(.006));q.y+=fl*.003*sin(t*6.+p.x*260.)*calm;
 // palm fronds bend from the trunk
 float a1=(1.-smoothstep(.12,.2,p.y+max(0.,(p.x-.22))*.28))*(1.-smoothstep(.29,.345,p.x))*smoothstep(.04,.2,distance(p*vec2(1.78,1.),vec2(.1,-.05)));
 float a2=(1.-smoothstep(.17,.27,p.y))*smoothstep(.74,.79,p.x)*smoothstep(.03,.25,distance(p*vec2(1.78,1.),vec2(1.75,-.03)));
 q+=a1*vec2(.0055*sin(t*1.15+p.x*9.),.0075*sin(t*1.4+p.x*14.))*sway;
 q+=a2*vec2(.0055*sin(t*1.05+2.+p.x*9.),.008*sin(t*1.3+p.x*13.))*sway;
 // hanging lanterns
 float l1=box(p,vec2(.033,.17),vec2(.08,.35),vec2(.008,.012));q=mix(q,turn(q,vec2(.057,.12),.055*sin(t*1.25)*sway),l1);
 float l2=box(p,vec2(.948,.32),vec2(.992,.485),vec2(.008,.012));q=mix(q,turn(q,vec2(.97,.26),.055*sin(t*1.1+1.5)*sway),l2);
 // water
 float w=m.r;
 vec2 wave=vec2(sin(p.y*(330.-190.*depth)+t*1.9+sin(p.x*21.+t*.6)*1.8)+.6*sin(p.x*46.+p.y*120.-t*1.3),
                sin(p.x*(58.-20.*depth)+t*1.5+p.y*60.)+.5*sin(p.x*27.-t*1.1+p.y*90.));
 q+=w*wave*vec2(.0011+.0024*depth,.0007+.0034*depth)*calm*(1.+storm*1.6);
 vec3 c=texture2D(pic,q).rgb;
 // clouds drift with two crossfaded phases
 if(sky>.004){float d=26.;float f0=fract(t/d),f1=fract(t/d+.5),k=abs(f0*2.-1.);vec2 drift=vec2(.03,.0)*(1.+storm)*calm;
  vec3 c0=texture2D(pic,q-drift*(f0-.5)*sky).rgb,c1=texture2D(pic,q-drift*(f1-.5)*sky).rgb;c=mix(c0,c1,k);}
 // waterfalls
 float wf=box(p,vec2(.787,.218),vec2(.808,.315),vec2(.003,.008))+box(p,vec2(.645,.36),vec2(.664,.45),vec2(.003,.008));
 if(wf>.01){float f0=fract(t*1.1),f1=fract(t*1.1+.5),k=abs(f0*2.-1.);vec2 d=vec2(0.,.028);
  c=mix(c,mix(texture2D(pic,q-d*(f0-.5)).rgb,texture2D(pic,q-d*(f1-.5)).rgb,k),wf);c+=wf*.06*noise(vec2(p.x*900.,p.y*160.-t*13.));}
 // sun glitter
 float near=.25+.75*exp(-pow((p.x-.17)*4.2,2.));
 float g=noise(vec2(p.x*(340.-210.*depth)+sin(t*.4)*2.,p.y*(900.-560.*depth)-t*1.1));g*=noise(vec2(p.x*120.-t*.9,p.y*420.+t*.7));
 c+=w*smoothstep(.56,.82,g)*near*vec3(1.,.93,.7)*.75*(1.-storm*.8)*calm;
 // grades
 float lum=dot(c,vec3(.3,.59,.11));
 vec3 dusk=c*vec3(1.1,.70,.52)+vec3(.10,.018,.05)*(1.-lum);
 dusk=mix(dusk,dusk*vec3(.72,.62,.86),smoothstep(.45,1.,p.y)*.55);
 float sun=exp(-pow(distance(p*vec2(1.78,1.),vec2(.27,.28))*2.3,2.));dusk+=vec3(.55,.26,.05)*sun*.55;
 c=mix(c,dusk,sunset);
 vec3 gale=mix(vec3(lum),c,.36)*vec3(.40,.50,.60);gale*=1.-.28*m.g;
 float cl=noise(vec2(p.x*5.+t*.05,p.y*7.))*.6+noise(vec2(p.x*13.+t*.1,p.y*17.))*.4;gale*=1.-.42*m.g*smoothstep(.35,.75,cl)*(1.-smoothstep(.1,.32,p.y));
 gale+=w*smoothstep(.62,.86,noise(vec2(p.x*60.+t*1.2,p.y*150.-t*.8)))*.10*depth;
 float bl=exp(-pow(distance(p*vec2(1.78,1.),vec2(1.02,.1))*1.9,2.));gale+=vec3(.5,.6,.78)*bolt*(m.g*(.35+bl)+.06);
 c=mix(c,gale,storm);
 // lantern light
 float fk=.82+.18*noise(vec2(t*5.,1.));
 float L=exp(-pow(distance(p*vec2(1.78,1.),vec2(.096,.295))*11.,2.))+exp(-pow(distance(p*vec2(1.78,1.),vec2(1.728,.425))*11.,2.));
 float wide=exp(-pow(distance(p*vec2(1.78,1.),vec2(.096,.295))*3.4,2.))+exp(-pow(distance(p*vec2(1.78,1.),vec2(1.728,.425))*3.4,2.));
 c+=vec3(1.,.55,.16)*(L*(.32+.75*storm)+wide*(.05+.16*max(sunset,storm)))*fk;
 // a broadside lights the galleon
 c+=vec3(1.,.7,.34)*shot*exp(-pow(distance(p*vec2(1.78,1.),vec2(.43,.42))*5.5,2.))*.9;
 // the deck below the picture stays dark under the console
 c*=1.-smoothstep(.97,1.16,base.y)*.62;
 gl_FragColor=vec4(c,1.);}`;
export class Harbor{
  private gl?:WebGLRenderingContext;private sh?:ReturnType<typeof program>;ready=false;private dead=false;
  time=0;sunset=0;storm=0;bolt=0;shot=0;calm=1;lean=0;place={x:0,y:0,z:1};
  constructor(public canvas:HTMLCanvasElement){}
  async load(){
    const [pic,mask]=await Promise.all([loadImage(MEDIA+'harbor.webp'),loadImage(MEDIA+'harbor-mask.webp')]);
    if(this.dead)return;
    try{const gl=this.canvas.getContext('webgl',{alpha:false,antialias:false})!;this.gl=gl;this.sh=program(gl,FRAG);
      gl.activeTexture(gl.TEXTURE0);texture(gl,pic);gl.activeTexture(gl.TEXTURE1);texture(gl,mask);this.sh.unit('pic',0);this.sh.unit('mask',1);this.ready=true;
    }catch{this.canvas.style.background=`url(${MEDIA}harbor.webp) center/cover`;}
  }
  resize(w:number,h:number,dpr:number){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
  draw(w:number,h:number){
    if(!this.ready)return;const gl=this.gl!,s=this.sh!;gl.viewport(0,0,this.canvas.width,this.canvas.height);
    const q=this.lean,p=this.place;s.set('size',w,h);s.set('place',p.x-q*(w*.2-p.x),p.y-q*(h*.4-p.y),p.z*(1+q));s.set('t',this.time);s.set('sunset',this.sunset);s.set('storm',this.storm);s.set('bolt',this.bolt);s.set('shot',this.shot);s.set('calm',this.calm);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  destroy(){this.dead=true;this.ready=false;this.sh?.free();}
}
