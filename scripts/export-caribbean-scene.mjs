/**
 * Technical media of the Caribbean scene, made from what the game already has. Usage: node scripts/export-caribbean-scene.mjs
 * harbor-mask.webp: water (red) and sky (green) of the existing harbour picture. gun.webp: the deck gun, sculpted as a
 * distance field, lit by the harbour sun and painted over with a brush filter. Needs an installed Chrome with a GPU.
 */
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../public/assets/caribbean-treasures/',import.meta.url)),W=800,H=450;
const px=await sharp(root+'harbor.webp').resize(W,H).removeAlpha().raw().toBuffer();
const at=(x,y)=>{const i=(y*W+x)*3;return[px[i],px[i+1],px[i+2]];};
function flood(starts,ok){const m=new Uint8Array(W*H),q=[...starts];while(q.length){const [x,y]=q.pop();if(x<0||y<0||x>=W||y>=H||m[y*W+x]||!ok(x,y))continue;m[y*W+x]=1;q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}return m;}
const horizon=204;
const sky=flood([[400,20],[300,60],[480,90]],(x,y)=>{if(y>horizon-6||x<205)return false;const [r,g,b]=at(x,y);return b>=r-4&&b>=g-14&&b>120&&(r+g+b)>330;});
const water=flood([[400,300],[250,330],[600,330],[200,260],[660,240]],(x,y)=>{if(y<horizon+1||y>374)return false;const [r,g,b]=at(x,y);return g>r-6&&b>r-12&&!(r>235&&g>225&&b<200);});
const rgb=Buffer.alloc(W*H*3);for(let i=0;i<W*H;i++){rgb[i*3]=water[i]*255;rgb[i*3+1]=sky[i]*255;}
// Feather inwards, so a moving pixel never drags the shore or a palm with it.
const ch=async k=>{const one=Buffer.alloc(W*H);for(let i=0;i<W*H;i++)one[i]=rgb[i*3+k];
 return sharp(one,{raw:{width:W,height:H,channels:1}}).blur(k?5:2.2).linear(2,-255).blur(k?4:1.2).toColourspace('b-w').raw().toBuffer();};
const r=await ch(0),g=await ch(1);for(let i=0;i<W*H;i++){rgb[i*3]=r[i];rgb[i*3+1]=g[i];}
await sharp(rgb,{raw:{width:W,height:H,channels:3}}).webp({quality:82}).toFile(root+'harbor-mask.webp');
// The gun.
await (async()=>{
const FRAG=`precision highp float;uniform vec2 size;
mat2 rot(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float ns(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return ns(p)*.55+ns(p*2.1+3.)*.3+ns(p*4.3+7.)*.15;}
float bx(vec3 p,vec3 b,float r){vec3 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.)-r;}
float cz(vec3 p,float r,float h,float k){vec2 d=vec2(length(p.xy)-r,abs(p.z)-h)+k;return min(max(d.x,d.y),0.)+length(max(d,0.))-k;}
vec2 U(vec2 a,vec2 b){return a.x<b.x?a:b;}
const float EL=.50;
vec3 gunSpace(vec3 p){p.y-=.46;p.xy=rot(EL)*p.xy;p.x-=.19;return p;}
float ring(float x,float c,float w,float k){return k*smoothstep(w,w*.35,abs(x-c));}
float barrel(vec3 p){
 vec3 q=gunSpace(p);float x=q.x,r=length(q.yz);
 float t=clamp((x+.46)/1.28,0.,1.);float R=mix(.172,.108,t);
 R+=ring(x,-.44,.035,.026)+ring(x,-.36,.018,.010)+ring(x,-.14,.030,.020)+ring(x,-.10,.012,.012)+ring(x,.20,.026,.018)+ring(x,.24,.011,.010)+ring(x,.62,.022,.016);
 R+=.040*smoothstep(.64,.80,x)*smoothstep(.0,.02,.845-x+.02)+ring(x,.81,.030,.016);
 R*=1.-.55*smoothstep(-.44,-.56,x);
 float d=max(r-R,max(x-.835,-.53-x));
 d=max(d,-max(r-.072,.55-x));
 float knob=length(q-vec3(-.64,0.,0.))-.058;float neck=max(length(q.yz)-.032,abs(x+.56)-.08);
 d=min(d,min(knob,neck));
 return d*.62;}
float dolphin(vec3 p){vec3 q=gunSpace(p)-vec3(.02,.165,0.);q.z=abs(q.z)-.055;vec2 k=vec2(length(vec2(q.x*.62,q.y))-.062,q.z);return length(k)-.017;}
float cheek(vec3 p){p.z=abs(p.z)-.185;float d=bx(p-vec3(.03,.215,0.),vec3(.45,.075,.045),.012);
 d=min(d,bx(p-vec3(.06,.30,0.),vec3(.33,.06,.045),.012));d=min(d,bx(p-vec3(.13,.385,0.),vec3(.20,.06,.045),.012));
 d=max(d,-(length(p.xy-vec2(0.,.452))-.055));return d;}
vec2 map(vec3 p){
 vec2 r=vec2(barrel(p),1.);r=U(r,vec2(dolphin(p),1.));
 r=U(r,vec2(cz(gunSpace(p)-vec3(-.19,-.01,0.),.047,.25,.01),1.));
 r=U(r,vec2(cheek(p),2.));
 r=U(r,vec2(bx(p-vec3(.0,.18,0.),vec3(.40,.03,.15),.01),2.));
 vec3 qn=p-vec3(-.26,.30,0.);qn.xy=rot(-.1)*qn.xy;r=U(r,vec2(bx(qn,vec3(.16,.055,.10),.01),2.));
 for(int i=0;i<2;i++){float x=i==0?-.28:.30;r=U(r,vec2(bx(p-vec3(x,.135,0.),vec3(.06,.05,.23),.015),2.));
  vec3 w=p-vec3(x,.125,0.);w.z=abs(w.z)-.275;r=U(r,vec2(cz(w,.125,.040,.012),3.));
  float tyre=max(cz(w,.130,.026,.004),-cz(w,.116,.1,.0));r=U(r,vec2(tyre,4.));
  r=U(r,vec2(cz(w-vec3(0.,0.,.0),.038,.062,.012),1.));}
 vec3 b=p;b.z=abs(b.z)-.235;
 r=U(r,vec2(bx(b-vec3(.03,.215,0.),vec3(.022,.07,.006),.004),4.));
 r=U(r,vec2(bx(b-vec3(.13,.385,0.),vec3(.018,.055,.006),.004),4.));
 vec3 cap=b-vec3(0.,.475,-.04);r=U(r,vec2(max(length(cap.xy)-.075,max(abs(cap.z)-.045,-cap.y+.0)),4.));
 for(int i=0;i<4;i++){vec3 c=b-vec3(i==0?-.34:i==1?-.18:i==2?.22:.40,i==0?.215:i==1?.31:i==2?.39:.215,0.);r=U(r,vec2(length(c*vec3(1.,1.,1.6))-.02,1.));}
 // breeching ring and a rope loop over the knob
 vec3 e=b-vec3(-.40,.25,.0);r=U(r,vec2(length(vec2(length(e.xy)-.045,e.z))-.011,4.));
 vec3 k=gunSpace(p)-vec3(-.585,0.,0.);r=U(r,vec2(length(vec2(length(k.yz)-.060,k.x))-.022,5.));
 return r;}
vec3 nrm(vec3 p){vec2 e=vec2(.0012,0.);return normalize(vec3(map(p+e.xyy).x-map(p-e.xyy).x,map(p+e.yxy).x-map(p-e.yxy).x,map(p+e.yyx).x-map(p-e.yyx).x));}
float shadow(vec3 p,vec3 l){float s=1.,t=.02;for(int i=0;i<44;i++){float d=map(p+l*t).x;s=min(s,9.*d/t);t+=clamp(d,.012,.08);if(s<.01||t>2.)break;}return clamp(s,0.,1.);}
float ao(vec3 p,vec3 n){float a=0.,w=1.;for(int i=1;i<6;i++){float d=.028*float(i);a+=(d-map(p+n*d).x)*w;w*=.72;}return clamp(1.-3.4*a,0.,1.);}
vec3 env(vec3 r){vec3 sky=mix(vec3(.93,.80,.55),vec3(.34,.58,.80),smoothstep(-.1,.8,r.y));vec3 deck=mix(vec3(.34,.19,.09),vec3(.12,.06,.03),smoothstep(0.,-.8,r.y));vec3 c=mix(deck,sky,smoothstep(-.16,.10,r.y));
 c+=vec3(1.5,1.1,.55)*pow(max(0.,dot(r,normalize(vec3(-.62,.62,.48)))),22.);c+=vec3(1.,.95,.8)*.8*smoothstep(.10,.02,abs(r.y-.40+.1*r.x));return c;}
vec4 shade(vec2 uv){
 vec3 ro=vec3(0.,0.,3.),rd=vec3(0.,0.,-1.);vec3 o=vec3(uv,3.);
 mat2 yw=rot(.24),pt=rot(-.14);
 o.y-=.0;o.yz=pt*o.yz;rd.yz=pt*rd.yz;o.xz=yw*o.xz;rd.xz=yw*rd.xz;o.y+=.40;
 float t=0.,m=-1.;for(int i=0;i<150;i++){vec2 d=map(o+rd*t);if(d.x<.0006){m=d.y;break;}t+=d.x*.8;if(t>6.)break;}
 if(m<0.)return vec4(0.);
 vec3 p=o+rd*t,n=nrm(p),l=normalize(vec3(-.55,.78,.52)),f=normalize(vec3(.7,.25,.35)),v=-rd;
 float A=ao(p,n),S=shadow(p+n*.004,l),D=max(0.,dot(n,l));vec3 alb,c;float spec=0.,metal=0.;
 vec3 g=gunSpace(p);
 if(m<1.5){alb=vec3(.80,.50,.15);metal=1.;float pat=fbm(vec2(g.x*9.,atan(g.z,g.y)*3.));alb*=.78+.34*pat;alb=mix(alb,vec3(.30,.36,.22),.22*smoothstep(.55,.8,fbm(g.xy*14.+2.)));spec=1.;}
 else if(m<2.5){float gr=fbm(vec2(p.x*5.,(p.y+p.z*.6)*46.));alb=mix(vec3(.20,.095,.042),vec3(.50,.26,.11),gr);alb*=.8+.3*ns(vec2(p.x*30.,p.y*180.));spec=.18;}
 else if(m<3.5){vec3 w=p-vec3(p.x<0.02?-.28:.30,.125,0.);float a=atan(w.y,w.x);float gr=fbm(vec2(w.x*26.,w.y*7.));alb=mix(vec3(.22,.10,.045),vec3(.47,.24,.10),gr);alb*=.82+.18*smoothstep(.0,.06,abs(sin(a*2.)));spec=.15;}
 else if(m<4.5){alb=vec3(.115,.12,.13)*(.8+.5*fbm(p.xy*30.));spec=.7;}
 else{alb=mix(vec3(.62,.44,.24),vec3(.85,.68,.42),step(.5,fract((g.x*2.+atan(g.z,g.y)*1.3)*4.)));spec=.05;}
 vec3 sun=vec3(1.55,1.22,.78),amb=mix(vec3(.30,.20,.13),vec3(.42,.52,.62),n.y*.5+.5);
 c=alb*(sun*D*S+amb*.62*A+vec3(.16,.34,.42)*max(0.,dot(n,f))*.55*A+vec3(.34,.17,.06)*max(0.,-n.y)*.5*A);
 vec3 r=reflect(rd,n);float fr=pow(1.-max(0.,dot(n,v)),4.);
 if(metal>.5){vec3 e=env(r);c=c*.55+alb*e*1.05*mix(.35,1.,A)*mix(.55,1.,S);c+=vec3(1.,.93,.70)*pow(max(0.,dot(r,l)),34.)*1.5*S;}
 else c+=spec*(env(r)*(.10+fr*.55)*A+vec3(1.,.85,.6)*pow(max(0.,dot(r,l)),26.)*.8*S);
 c+=fr*vec3(.55,.62,.60)*.20*A;
 // the deck below keeps the feet dark
 c*=mix(.62,1.,smoothstep(-.02,.30,p.y));
 c=c/(1.+c*.22);c=pow(max(c,0.),vec3(.80));c=mix(vec3(dot(c,vec3(.3,.59,.11))),c,1.18);
 return vec4(c,1.);}
void main(){vec4 s=vec4(0.);for(int i=0;i<3;i++)for(int j=0;j<3;j++){vec2 q=(gl_FragCoord.xy+vec2(float(i),float(j))/3.-.33-size*.5)/size.y*1.46;q+=vec2(.20,.08);vec4 c=shade(q);s+=vec4(c.rgb*c.a,c.a);}
 gl_FragColor=s/9.;}`;
const W=1320,H=1080,b=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']}),p=await b.newPage();
const url=await p.evaluate(({FRAG,W,H})=>{const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('webgl',{premultipliedAlpha:true,preserveDrawingBuffer:true});
 const mk=(t,s)=>{const x=g.createShader(t);g.shaderSource(x,s);g.compileShader(x);if(!g.getShaderParameter(x,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(x));return x;};
 const q=g.createProgram();g.attachShader(q,mk(g.VERTEX_SHADER,'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));g.attachShader(q,mk(g.FRAGMENT_SHADER,FRAG));g.linkProgram(q);g.useProgram(q);
 g.bindBuffer(g.ARRAY_BUFFER,g.createBuffer());g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),g.STATIC_DRAW);const l=g.getAttribLocation(q,'a');g.enableVertexAttribArray(l);g.vertexAttribPointer(l,2,g.FLOAT,false,0,0);g.uniform2f(g.getUniformLocation(q,'size'),W,H);g.enable(g.SCISSOR_TEST);
 for(let y=0;y<H;y+=60){g.scissor(0,y,W,60);g.drawArrays(g.TRIANGLES,0,3);g.finish();}
 return c.toDataURL('image/png');},{FRAG,W,H});
await b.close();
const raw=await sharp(Buffer.from(url.split(',')[1],'base64')).ensureAlpha().raw().toBuffer();
// Kuwahara brush: the calmest of four neighbouring strokes wins, so shading breaks into painted patches.
const R=4,out=Buffer.from(raw);
for(let y=R;y<H-R;y++)for(let x=R;x<W-R;x++){const i=(y*W+x)*4;if(raw[i+3]<8)continue;let best=1e12,br=0,bg=0,bb=0;
 for(const [ox,oy] of [[-R,-R],[0,-R],[-R,0],[0,0]]){let n=0,r=0,g=0,bl=0,s=0,s2=0;for(let yy=0;yy<=R;yy++)for(let xx=0;xx<=R;xx++){const j=((y+oy+yy)*W+x+ox+xx)*4;if(raw[j+3]<200)continue;const L=raw[j]*.3+raw[j+1]*.59+raw[j+2]*.11;n++;r+=raw[j];g+=raw[j+1];bl+=raw[j+2];s+=L;s2+=L*L;}
  if(!n)continue;const v=s2/n-(s/n)**2+(n<12?40:0);if(v<best){best=v;br=r/n;bg=g/n;bb=bl/n;}}
 if(best<1e12){out[i]=br;out[i+1]=bg;out[i+2]=bb;}}
const trimmed=await sharp(out,{raw:{width:W,height:H,channels:4}}).resize(660,540,{kernel:'lanczos3'}).sharpen({sigma:.7,m1:.6,m2:1.2}).webp({quality:90,alphaQuality:95}).toBuffer();
await writeFile(root+'gun.webp',trimmed);console.log('gun',trimmed.length);

})();
