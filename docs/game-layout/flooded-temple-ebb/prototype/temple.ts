/** The existing temple painting, brought to life. Draining replaces only its water with a wet stone floor. */
import {loadImage,program,texture} from './gl';
const FRAG=`precision highp float;varying vec2 v;
uniform sampler2D pic,mask;uniform vec2 size;uniform vec3 place;uniform float t,dry,holy,calm,ebb,flash;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return noise(p)*.55+noise(p*2.1+3.)*.3+noise(p*4.3+7.)*.15;}
vec3 floorAt(vec2 p){
 float z=1./(p.y-.395+.02);vec2 f=vec2((p.x-.5)*z*1.15,z*1.05);
 float row=floor(f.y*1.3);vec2 c=vec2(f.x*.8+.5*mod(row,2.),f.y*1.3);vec2 id=floor(c),q=fract(c);
 float far=smoothstep(.30,.95,p.y);
 float w=mix(.2,.045,far);float edge=smoothstep(0.,w,q.x)*smoothstep(0.,w,1.-q.x)*smoothstep(0.,w,q.y)*smoothstep(0.,w,1.-q.y);
 float n=fbm(c*5.)*.6+fbm(c*17.)*.4;vec3 s=mix(vec3(.12,.17,.17),vec3(.30,.31,.25),n)*(.78+.4*hash(id));
 s*=mix(.45,1.,edge);
 float wet=smoothstep(.45,.75,fbm(f*.9+4.));s=mix(s,s*.6+texture2D(pic,vec2(p.x,clamp(.80-p.y*.62,0.,1.))).rgb*.42,wet*.75);
 return s;
}
void main(){
 vec2 p=(v*size-place.xy)/(place.z*vec2(1536.,1024.));if(p.y>1.)p.y=2.-p.y;if(p.x<0.)p.x=-p.x;if(p.x>1.)p.x=2.-p.x;p=clamp(p,0.,1.);
 vec4 m=texture2D(mask,p);float w=m.r,depth=clamp((p.y-.455)/.5,0.,1.);
 vec2 q=p;
 vec2 wave=vec2(sin(p.y*(300.-190.*depth)+t*1.7+sin(p.x*19.+t*.6)*1.8)+.6*sin(p.x*40.+p.y*110.-t*1.2),sin(p.x*(56.-24.*depth)+t*1.4+p.y*60.)+.5*sin(p.x*27.-t*1.1+p.y*90.));
 q+=w*wave*vec2(.0012+.0028*depth,.0007+.0032*depth)*calm*(1.+ebb*1.6);
 // vines sway at the top corners
 float vine=(1.-smoothstep(.02,.2,p.y))*smoothstep(.0,.06,p.y)*(1.-smoothstep(.28,.33,p.x)+smoothstep(.9,.95,p.x));q.x+=vine*.0022*sin(t*.9+p.y*22.)*calm;
 // flames lick upwards
 float fi=m.b;q+=fi*vec2(sin(t*9.+p.y*190.),sin(t*7.+p.x*240.))*vec2(.0016,.0011)*calm;
 vec3 c=texture2D(pic,q).rgb;
 if(m.g>.02){float f0=fract(t*.9),f1=fract(t*.9+.5),k=abs(f0*2.-1.);vec2 d=vec2(0.,.034)*calm;c=mix(c,mix(texture2D(pic,q-d*(f0-.5)).rgb,texture2D(pic,q-d*(f1-.5)).rgb,k),m.g);c+=m.g*.10*noise(vec2(p.x*800.,p.y*140.-t*12.))*calm;}
 // glitter of the bowls on the water
 float g=noise(vec2(p.x*(300.-190.*depth)+sin(t*.4)*2.,p.y*(820.-520.*depth)-t*1.1))*noise(vec2(p.x*110.-t*.9,p.y*380.+t*.7));
 c+=w*smoothstep(.5,.8,g)*vec3(.55,.92,.95)*.42*calm*(.35+.65*depth);
 // the pool empties from the near shore to the far one
 if(dry>.001){float line=mix(1.12,.30,dry)+.02*sin(p.x*22.+t)+.02*noise(vec2(p.x*30.,t*.6));float k=smoothstep(line-.02,line+.05,p.y)*w;
  vec3 fl=floorAt(p);c=mix(c,fl,k);c+=w*smoothstep(.05,.0,abs(p.y-line))*vec3(.55,.8,.8)*.5*(1.-smoothstep(.9,1.,dry));}
 c+=fi*vec3(1.,.55,.16)*(.18+.22*noise(vec2(t*7.,p.x*40.)));
 // slow mist over the far water
 float mist=exp(-pow((p.y-.47)*9.,2.))*fbm(vec2(p.x*5.-t*.035,p.y*9.+t*.01));c=mix(c,vec3(.36,.60,.68),mist*.26*calm);
 // light falling through the broken vault
 vec2 o=vec2(.56,-.12),r=p-o;float a=atan(r.x,r.y);float ray=pow(max(0.,noise(vec2(a*13.+t*.05,1.))*.6+noise(vec2(a*29.-t*.07,5.))*.4),2.4)*exp(-length(r)*1.6)*smoothstep(.75,.1,abs(a));
 c+=ray*mix(vec3(.45,.75,.9),vec3(1.,.82,.45),holy)*.75;
 float lum=dot(c,vec3(.3,.59,.11));
 vec3 gold=mix(vec3(lum),c,.55)*vec3(1.34,1.08,.70)+vec3(.045,.03,.0);gold+=vec3(.25,.62,.52)*exp(-pow(distance(p*vec2(1.5,1.),vec2(.72,.55))*1.9,2.))*.13;
 c=mix(c,gold,holy);c+=flash*vec3(.45,.75,.7)*.35;
 vec2 e=v-.5;c*=1.-dot(e,e)*.62;
 gl_FragColor=vec4(c,1.);}`;
export class Temple{
  private gl?:WebGLRenderingContext;private sh?:ReturnType<typeof program>;
  time=0;dry=0;holy=0;calm=1;ebb=0;flash=0;place={x:0,y:0,z:1};
  constructor(public canvas:HTMLCanvasElement){}
  async load(){
    const [pic,mask]=await Promise.all([loadImage('assets/temple.webp'),loadImage('assets/temple-mask.webp')]);
    try{const gl=this.canvas.getContext('webgl',{alpha:false,antialias:false})!;this.gl=gl;this.sh=program(gl,FRAG);gl.activeTexture(gl.TEXTURE0);texture(gl,pic);gl.activeTexture(gl.TEXTURE1);texture(gl,mask);this.sh.unit('pic',0);this.sh.unit('mask',1);}
    catch(e){console.warn('temple',e);this.gl=undefined;this.canvas.style.background='url(assets/temple.webp) center/cover';}
  }
  resize(w:number,h:number){const d=Math.min(1.25,devicePixelRatio||1);this.canvas.width=Math.round(w*d);this.canvas.height=Math.round(h*d);}
  draw(w:number,h:number){const gl=this.gl,s=this.sh;if(!gl||!s)return;gl.viewport(0,0,this.canvas.width,this.canvas.height);s.set('size',w,h);s.set('place',this.place.x,this.place.y,this.place.z);s.set('t',this.time);s.set('dry',this.dry);s.set('holy',this.holy);s.set('calm',this.calm);s.set('ebb',this.ebb);s.set('flash',this.flash);gl.drawArrays(gl.TRIANGLES,0,3);}
}
