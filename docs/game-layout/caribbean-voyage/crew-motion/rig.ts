/**
 * A living pirate made of layers cut from her own painting: a bending body mesh, face patches,
 * spring chains for a braid or a scarf, a pendulum for an earring, a swapping forearm and gesture plates.
 * Every coordinate is in master pixels (1024 x 1536).
 */
export type Box=[number,number,number,number];
export type Pt=[number,number];
export type RigData={id:string;crops:Record<string,Box>;
 neck:Pt;head:{top:number;bottom:number;left:number;right:number};chest:{c:Pt;r:Pt};feet:Pt;
 hair?:{a:Pt;r:Pt;side:number}[];feather?:{base:Pt;box:Box};coat?:{top:number};
 chains?:{layer:string;spine:Pt[];stiff:number;heavy:number}[];pendulums?:{layer:string;hook:Pt;len:number}[];
 forearm?:{pivot:Pt};gestures:string[];
 /** per gesture: shoulder, the angle the new arm comes in from, the angle the old forearm leaves towards */
 moves:Record<string,{origin:Pt;from:number;lift:number;fade?:boolean;fixed?:[number,number,number,number]}>;hides?:Record<string,string[]>;character:{tempo:number;sway:number;bounce:number}};
export type Emotion='idle'|'focus'|'win'|'big'|'surprise'|'soft'|'bonus';
const FACES=['blink','smile','laugh','surprise','soft','focus'] as const;type Face=typeof FACES[number];
const VS=`attribute vec2 p,r;uniform vec2 view;varying vec2 v;void main(){v=r;gl_Position=vec4(p.x/view.x*2.-1.,1.-p.y/view.y*2.,0.,1.);}`;
// body: base colour replaced inside the masks of the active gestures
const FS_BODY=`precision mediump float;varying vec2 v;uniform sampler2D tex,g1,m1,g2,m2;uniform vec4 box,b1,b2,o1,o2;uniform float light,flash;uniform vec4 f1,f2;uniform vec3 tint;
float inb(vec4 f,vec2 p){return step(f.x,p.x)*step(p.x,f.z)*step(f.y,p.y)*step(p.y,f.w);}
vec2 turn(vec4 o){vec2 d=v-o.xy;float c=cos(-o.z),s=sin(-o.z);return o.xy+vec2(c*d.x-s*d.y,s*d.x+c*d.y);}
vec4 at(sampler2D t,vec4 b,vec2 q){vec2 u=(q-b.xy)/b.zw;return(u.x<0.||u.y<0.||u.x>1.||u.y>1.)?vec4(0.):texture2D(t,u);}
float mk(sampler2D t,vec4 b,vec2 q){vec2 u=(q-b.xy)/b.zw;return(u.x<0.||u.y<0.||u.x>1.||u.y>1.)?0.:texture2D(t,u).r;}
void main(){vec4 c=at(tex,box,v);vec2 q1=turn(o1);c=mix(c,at(g1,b1,v),o1.w*smoothstep(0.,.06,mk(m1,b1,v))*inb(f1,v));vec4 p1=at(g1,b1,q1);float r1=1.-smoothstep(0.,.12,abs(o1.z));c=mix(c,mix(p1+c*(1.-p1.a),p1,r1),o1.w*mk(m1,b1,q1)*(1.-inb(f1,q1)));vec2 q2=turn(o2);c=mix(c,at(g2,b2,v),o2.w*smoothstep(0.,.06,mk(m2,b2,v))*inb(f2,v));vec4 p2=at(g2,b2,q2);float r2=1.-smoothstep(0.,.12,abs(o2.z));c=mix(c,mix(p2+c*(1.-p2.a),p2,r2),o2.w*mk(m2,b2,q2)*(1.-inb(f2,q2)));
 c.rgb*=tint;c.rgb*=1.+light*(.08-.13*v.x/1024.);c.rgb+=c.a*flash*vec3(1.,.72,.38)*.3*smoothstep(1024.,0.,v.x);gl_FragColor=vec4(min(c.rgb,vec3(c.a)),c.a);}`;
const FS_LAYER=`precision mediump float;varying vec2 v;uniform sampler2D tex;uniform vec4 box,h1,h2;uniform float alpha,light,flash;uniform vec3 tint;
void main(){vec2 u=(v-box.xy)/box.zw;vec4 c=(u.x<0.||u.y<0.||u.x>1.||u.y>1.)?vec4(0.):texture2D(tex,u);c*=alpha*(1.-h1.w)*(1.-h2.w);c.rgb*=tint;c.rgb*=1.+light*(.08-.13*v.x/1024.);c.rgb+=c.a*flash*vec3(1.,.72,.38)*.3*smoothstep(1024.,0.,v.x);gl_FragColor=vec4(min(c.rgb,vec3(c.a)),c.a);}`;
const ss=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const rot=(x:number,y:number,a:number):Pt=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];
class Spring{x=0;v=0;constructor(public k:number,public d:number){}step(target:number,dt:number,force=0){const a=-this.k*(this.x-target)-this.d*this.v+force;this.v+=a*dt;this.x+=this.v*dt;return this.x;}}
type Mesh={buf:WebGLBuffer;rest:Float32Array;pos:Float32Array;idx:WebGLBuffer;count:number;w:Float32Array[]};
export class Rig{
 private gl:WebGLRenderingContext;private pb:WebGLProgram;private pl:WebGLProgram;private tex=new Map<string,WebGLTexture>();private meshes=new Map<string,Mesh>();
 private ib?:WebGLBuffer;ready=false;time=0;live=1;wind=0;flash=0;tint:[number,number,number]=[1,1,1];
 private emotion:Emotion='idle';private emoT=0;private hold=0;private face:Record<Face,number>={blink:0,smile:0,laugh:0,surprise:0,soft:0,focus:0};
 private faceT:Record<Face,number>={...this.face};private blinkAt=2;private blinkT=-1;private glanceAt=6;private glance=0;
 private gesture:Record<string,number>={};private gestureT:Record<string,number>={};
 // springs: head turn and nod, body lean, bounce, feather, coat, hair
 private head=new Spring(30,9);private nod=new Spring(34,10);private lean=new Spring(18,7);private bounce=new Spring(70,9);private feather=new Spring(55,5);private coat=new Spring(22,4);private hair=new Spring(26,4);
 private chainState:{a:Float32Array;v:Float32Array}[]=[];private pend:Spring[]=[];private last={hx:0,hy:0,vx:0,vy:0};
 constructor(public canvas:HTMLCanvasElement,public data:RigData,private base:string){
  const gl=canvas.getContext('webgl',{premultipliedAlpha:true,alpha:true,antialias:true});if(!gl)throw Error('webgl');this.gl=gl;
  this.pb=this.program(FS_BODY);this.pl=this.program(FS_LAYER);
  this.chainState=(data.chains??[]).map(c=>({a:new Float32Array(c.spine.length-1),v:new Float32Array(c.spine.length-1)}));
  this.pend=(data.pendulums??[]).map(()=>new Spring(28,3));
 }
 private program(fs:string){const gl=this.gl,mk=(t:number,s:string)=>{const h=gl.createShader(t)!;gl.shaderSource(h,s);gl.compileShader(h);if(!gl.getShaderParameter(h,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(h)!);return h;};
  const p=gl.createProgram()!;gl.attachShader(p,mk(gl.VERTEX_SHADER,VS));gl.attachShader(p,mk(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);return p;}
 async load(){
  const gl=this.gl,names=Object.keys(this.data.crops);const extra=this.data.gestures.map(g=>'gesture-'+g+'-mask');
  await Promise.all([...names,...extra].map(async n=>{const img=new Image();img.src=this.base+n+'.webp';await img.decode();const t=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);this.tex.set(n,t);}));
  for(const n of names)this.meshes.set(n,this.mesh(this.data.crops[n],n.startsWith('face-')?10:n==='body'?36:20));
  this.ready=true;
 }
 /** A grid over a crop, with per vertex weights of every deformation precomputed at rest. */
 private mesh(b:Box,n:number):Mesh{
  const gl=this.gl,cols=Math.max(4,Math.round(n*b[2]/Math.max(b[2],b[3]))),rows=Math.max(4,Math.round(n*b[3]/Math.max(b[2],b[3]))),rest=new Float32Array((cols+1)*(rows+1)*2);
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const k=(j*(cols+1)+i)*2;rest[k]=b[0]+b[2]*i/cols;rest[k+1]=b[1]+b[3]*j/rows;}
  const idx:number[]=[];for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i;idx.push(a,a+1,a+cols+1,a+1,a+cols+2,a+cols+1);}
  const ib=gl.createBuffer()!;gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(idx),gl.STATIC_DRAW);
  const D=this.data,V=rest.length/2,w=Array.from({length:6},()=>new Float32Array(V));
  for(let q=0;q<V;q++){const x=rest[q*2],y=rest[q*2+1],h=D.head;
   w[0][q]=ss(h.bottom,h.top,y)*ss(h.left-80,h.left,x)*(1-ss(h.right,h.right+80,x)); // head
   const cx=(x-D.chest.c[0])/D.chest.r[0],cy=(y-D.chest.c[1])/D.chest.r[1];w[1][q]=Math.exp(-(cx*cx+cy*cy)*1.4); // chest
   w[2][q]=D.feather&&x>D.feather.box[0]&&x<D.feather.box[2]&&y>D.feather.box[1]&&y<D.feather.box[3]?ss(D.feather.box[0],D.feather.base[0]+60,x):0; // feather
   w[3][q]=D.coat?ss(D.coat.top,1536,y):0; // coat hem
   let hw=0;for(const e of D.hair??[]){const dx=(x-e.a[0])/e.r[0],dy=(y-e.a[1])/e.r[1];const d=dx*dx+dy*dy;if(d<1)hw=Math.max(hw,(1-d)*ss(e.a[1]-e.r[1],e.a[1]+e.r[1]*.6,y)*e.side);}w[4][q]=hw; // hair mass
   w[5][q]=1-y/1536; // height for the lean
  }
  const buf=gl.createBuffer()!;return{buf,rest,pos:new Float32Array(rest.length*2),idx:ib,count:idx.length,w};
 }
 react(e:Emotion,hold=0){this.emotion=e;this.emoT=0;this.hold=hold;
  const c=this.data.character;
  if(e==='surprise'){this.lean.v-=1.6;this.bounce.v-=1.2;this.kick(2.2);}
  if(e==='win'){this.bounce.v-=2.4*c.bounce;this.kick(1);}
  if(e==='big'){this.bounce.v-=3.2*c.bounce;this.kick(1.6);}
  if(e==='soft'){this.nod.v+=.5;}
  if(e==='bonus'){this.lean.v+=.8;this.kick(.8);}
 }
 private kick(f:number){for(const s of this.chainState)for(let i=0;i<s.v.length;i++)s.v[i]+=(Math.random()-.4)*f*(i+1)/s.v.length;for(const p of this.pend)p.v+=(Math.random()-.5)*f*4;this.feather.v+=f*1.5;this.coat.v+=f*.8;this.hair.v+=f;}
 step(dt:number){
  if(!this.ready)return;dt=Math.min(.05,dt);this.time+=dt;this.emoT+=dt;const t=this.time,L=this.live,c=this.data.character,e=this.emotion;
  if(this.hold&&this.emoT>this.hold&&e!=='idle'){this.emotion='idle';this.emoT=0;this.hold=0;}
  // expression targets
  for(const f of FACES)this.faceT[f]=0;
  const g:Record<string,number>={};for(const n of this.data.gestures)g[n]=0;
  if(e==='focus')this.faceT.focus=1;
  if(e==='win'){this.faceT.smile=1;if(g.win!==undefined)g.win=1;}
  if(e==='big'){this.faceT.laugh=1;if(g.win!==undefined)g.win=1;}
  if(e==='surprise'){this.faceT.surprise=1;}
  if(e==='soft'){this.faceT.soft=1;}
  if(e==='bonus'){this.faceT.smile=.85;if(g.bonus!==undefined)g.bonus=1;}
  // idle life: glances at the field and an occasional private smile
  if(e==='idle'&&L){this.glanceAt-=dt;if(this.glanceAt<0){this.glance=this.glance?0:(Math.random()<.6?1:-1);this.glanceAt=this.glance?1.4+Math.random():4+Math.random()*4;}
   if(this.glance>0)this.faceT.focus=.9;if(this.glance<0)this.faceT.smile=.55;}
  const rate=(f:Face)=>f==='surprise'?16:9;
  for(const f of FACES)if(f!=='blink')this.face[f]+=(this.faceT[f]-this.face[f])*(1-Math.exp(-dt*rate(f)));
  // blinks: closing fast, opening slower, sometimes twice
  if(L){this.blinkAt-=dt;if(this.blinkAt<0&&this.blinkT<0&&this.face.laugh<.3&&this.face.surprise<.3){this.blinkT=0;this.blinkAt=Math.random()<.18?.32:2.4+Math.random()*3.6;}}
  if(this.blinkT>=0){this.blinkT+=dt;const u=this.blinkT;this.face.blink=u<.06?u/.06:u<.1?1:Math.max(0,1-(u-.1)/.11);if(u>.21){this.blinkT=-1;this.face.blink=0;}}
  for(const n of this.data.gestures){const target=g[n];const cur=this.gesture[n]??0;this.gesture[n]=target>cur?Math.min(1,cur+dt/.3):Math.max(0,cur-dt/.3);}
  // body: breath, weight shift, head follows half a beat later
  const tempo=c.tempo,breath=L*Math.sin(t*1.55*tempo)*(e==='soft'?.7:1)+(e==='big'?.6*Math.sin(t*9):0);
  const headTarget=L*(Math.sin(t*.55*tempo-.8)*.022+Math.sin(t*.27)*.012)*c.sway+(this.face.focus*-.05)+(e==='big'?.05:0)+(e==='surprise'?-.03:0);
  const nodTarget=(e==='soft'?.05:0)+(e==='big'?-.04*Math.abs(Math.sin(t*8)):0)+L*Math.sin(t*1.55*tempo+.6)*.006;
  const h=this.head.step(headTarget,dt),nd=this.nod.step(nodTarget,dt),ln=this.lean.step(L*Math.sin(t*.5*tempo)*.012*c.sway,dt),bo=this.bounce.step(0,dt);
  // head motion drives the springs of hair, scarf, braid and earring
  const hx=h*200,hy=nd*150,vx=(hx-this.last.hx)/dt,vy=(hy-this.last.hy)/dt,ax=(vx-this.last.vx)/dt;this.last={hx,hy,vx,vy};
  const gust=this.wind*(Math.sin(t*2.1)*.6+Math.sin(t*3.7+1)*.4)+L*Math.sin(t*1.1)*.15;
  this.feather.step(gust*.12,dt,-ax*.0016);this.coat.step(gust*.6+ln*4,dt,-ax*.004);this.hair.step(gust*.5,dt,-ax*.005);
  this.chainState.forEach((s,ci)=>{const ch=this.data.chains![ci];for(let i=0;i<s.a.length;i++){const lever=(i+1)/s.a.length;const k=ch.stiff*(1.3-lever*.6),drive=(-ax*.0011*lever+gust*.3*lever+Math.sin(t*1.7+i*.7)*.02*L*lever)*ch.heavy;
   s.v[i]+=(-k*s.a[i]-2.4*s.v[i]+drive*k*.5)*dt;s.a[i]+=s.v[i]*dt;s.a[i]=Math.max(-.6,Math.min(.6,s.a[i]));}});
  this.pend.forEach(p=>p.step(gust*.2,dt,-ax*.006-h*12));
  this.frame={h,nd,breath,ln,bo,coat:this.coat.x,feather:this.feather.x,hair:this.hair.x};
 }
 private frame={h:0,nd:0,breath:0,ln:0,bo:0,coat:0,feather:0,hair:0};
 /** The deformation shared by every layer. */
 private deform(m:Mesh,q:number,o:Pt){
  const D=this.data,F=this.frame,x0=m.rest[q*2],y0=m.rest[q*2+1];let x=x0,y=y0;
  // breath lifts and widens the chest
  const wc=m.w[1][q];x+=(x0-D.chest.c[0])*F.breath*.012*wc;y+=(y0-D.chest.c[1])*F.breath*.01*wc-F.breath*4*wc;
  // hem of the coat
  x+=F.coat*26*m.w[3][q]*((x0-512)/512+.4);
  // hair mass swings from the scalp
  const wh=m.w[4][q];x+=F.hair*22*wh+Math.sin(this.time*1.3+y0*.012)*3*wh*this.live;y+=Math.abs(F.hair)*4*wh;
  // head rotation about the neck, then the feather on top of it
  const wd=m.w[0][q];if(wd>0){const [rx,ry]=rot(x-D.neck[0],y-D.neck[1],(F.h)*wd);x=D.neck[0]+rx+F.h*30*wd;y=D.neck[1]+ry+F.nd*80*wd;}
  if(D.feather&&m.w[2][q]>0){const b=D.feather.base,[rx,ry]=rot(x-b[0],y-b[1],F.feather*m.w[2][q]);x=b[0]+rx;y=b[1]+ry;}
  // the whole figure leans over the feet and bounces
  const wl=m.w[5][q],[lx,ly]=rot(x-D.feet[0],y-D.feet[1],F.ln*wl);x=D.feet[0]+lx;y=D.feet[1]+ly+F.bo*22*wl;
  o[0]=x;o[1]=y;
 }
 private point(x:number,y:number,head=1):Pt{const m={rest:new Float32Array([x,y]),w:[new Float32Array([head]),new Float32Array([0]),new Float32Array([0]),new Float32Array([0]),new Float32Array([0]),new Float32Array([1-y/1536])]} as unknown as Mesh;const o:Pt=[0,0];this.deform(m,0,o);return o;}
 draw(){
  if(!this.ready)return;const gl=this.gl,cw=this.canvas.width,ch=this.canvas.height,sx=cw/1024,sy=ch/1536,o:Pt=[0,0],D=this.data;
  gl.viewport(0,0,cw,ch);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  const put=(m:Mesh,fn:(q:number,o:Pt)=>void)=>{const V=m.rest.length/2;for(let q=0;q<V;q++){fn(q,o);m.pos[q*4]=o[0]*sx;m.pos[q*4+1]=o[1]*sy;m.pos[q*4+2]=m.rest[q*2];m.pos[q*4+3]=m.rest[q*2+1];}};
  const send=(p:WebGLProgram,m:Mesh)=>{gl.bindBuffer(gl.ARRAY_BUFFER,m.buf);gl.bufferData(gl.ARRAY_BUFFER,m.pos,gl.DYNAMIC_DRAW);const a=gl.getAttribLocation(p,'p'),r=gl.getAttribLocation(p,'r');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(r);gl.vertexAttribPointer(r,2,gl.FLOAT,false,16,8);
   gl.uniform2f(gl.getUniformLocation(p,'view'),cw,ch);gl.uniform3f(gl.getUniformLocation(p,'tint'),...this.tint);gl.uniform1f(gl.getUniformLocation(p,'light'),1);gl.uniform1f(gl.getUniformLocation(p,'flash'),this.flash);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.idx);gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0);};
  const bind=(p:WebGLProgram,name:string,unit:number,tex:string,box?:string)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,this.tex.get(tex)??null);gl.uniform1i(gl.getUniformLocation(p,name),unit);if(box){const b=D.crops[tex.replace('-mask','')];gl.uniform4f(gl.getUniformLocation(p,box),b[0],b[1],b[2],b[3]);}};
  // body with the gesture plates
  gl.useProgram(this.pb);const gs=D.gestures;bind(this.pb,'tex',0,'body','box');
  const og=(g:string):[number,number,number,number]=>{const mv=D.moves[g],k=this.gesture[g]??0,b=Math.max(0,(k-.5)/.5);return[mv.origin[0],mv.origin[1],mv.from*(1-b)*(1-b),mv.fade?k*k*(3-2*k):k>=.5?1:0];};
  gs.slice(0,2).forEach((g,i)=>{gl.uniform4f(gl.getUniformLocation(this.pb,'f'+(i+1)),...(D.moves[g].fixed??[-1,-1,-1,-1]));gl.uniform4f(gl.getUniformLocation(this.pb,'o'+(i+1)),...og(g));bind(this.pb,'g'+(i+1),1+i*2,'gesture-'+g,'b'+(i+1));bind(this.pb,'m'+(i+1),2+i*2,'gesture-'+g+'-mask');gl.uniform1f(gl.getUniformLocation(this.pb,'w'+(i+1)),this.gesture[g]??0);});
  for(let i=gs.length;i<2;i++)gl.uniform4f(gl.getUniformLocation(this.pb,'o'+(i+1)),0,0,1,0);
  const body=this.meshes.get('body')!;put(body,(q,o)=>this.deform(body,q,o));send(this.pb,body);
  gl.useProgram(this.pl);const layer=(n:string,alpha:number,fn?:(m:Mesh,q:number,o:Pt)=>void,hide:string[]=[])=>{const m=this.meshes.get(n);if(!m||alpha<.003)return;bind(this.pl,'tex',0,n,'box');gl.uniform1f(gl.getUniformLocation(this.pl,'alpha'),alpha);
   for(let i=0;i<2;i++)gl.uniform4f(gl.getUniformLocation(this.pl,'h'+(i+1)),...(hide[i]?og(hide[i]):[0,0,1,0] as [number,number,number,number]));put(m,(q,o)=>(fn??((m,q,o)=>this.deform(m,q,o)))(m,q,o));send(this.pl,m);};
  // the face: expressions over each other, blink on top
  for(const f of ['soft','focus','smile','surprise','laugh','blink'] as Face[])layer('face-'+f,Math.min(1,this.face[f]));
    // forearm swings out of the way while a gesture plate comes in
  if(D.forearm){const fp=D.forearm.pivot,hide=D.hides?.forearm??D.gestures,swing=hide.reduce((a,n)=>{const k=this.gesture[n]??0;return a+D.moves[n].lift*Math.min(1,k/.5)**2;},0);layer('forearm',1,(m,q,o)=>{const x=m.rest[q*2],y=m.rest[q*2+1],F=this.frame,a=(Math.sin(this.time*1.55*D.character.tempo+1)*.012*this.live-F.breath*.01)+swing;const [rx,ry]=rot(x-fp[0],y-fp[1],a);const pv=this.point(fp[0],fp[1],0);o[0]=pv[0]+rx;o[1]=pv[1]+ry;},D.hides?.forearm??D.gestures);}
  (D.pendulums??[]).forEach((pd,i)=>{const hook=this.point(pd.hook[0],pd.hook[1]);layer(pd.layer,1,(m,q,o)=>{const x=m.rest[q*2],y=m.rest[q*2+1],a=this.pend[i].x+this.frame.h;const [rx,ry]=rot(x-pd.hook[0],y-pd.hook[1],a);o[0]=hook[0]+rx;o[1]=hook[1]+ry;});});
  (D.chains??[]).forEach((cd,ci)=>{
   // joints of the chain in screen space, the first one rides on the head
   const s=this.chainState[ci],J:Pt[]=[this.point(cd.spine[0][0],cd.spine[0][1])];let acc=this.frame.h;
   for(let i=0;i<s.a.length;i++){acc+=s.a[i];const d=rot(cd.spine[i+1][0]-cd.spine[i][0],cd.spine[i+1][1]-cd.spine[i][1],acc);J.push([J[i][0]+d[0],J[i][1]+d[1]]);}
   layer(cd.layer,1,(m,q,o)=>{const x=m.rest[q*2],y=m.rest[q*2+1];let best=0,bt=0,bd=1e9;
    for(let i=0;i<cd.spine.length-1;i++){const a=cd.spine[i],b=cd.spine[i+1],vx=b[0]-a[0],vy=b[1]-a[1],l2=vx*vx+vy*vy,u=Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/l2)),dx=x-a[0]-u*vx,dy=y-a[1]-u*vy,d=dx*dx+dy*dy;if(d<bd){bd=d;best=i;bt=u;}}
    // each point is carried by its segment and blended with the next one near the joint
    const seg=(i:number):Pt=>{const a=cd.spine[i],b=cd.spine[i+1],ang=Math.atan2(J[i+1][1]-J[i][1],J[i+1][0]-J[i][0])-Math.atan2(b[1]-a[1],b[0]-a[0]);const [rx,ry]=rot(x-a[0],y-a[1],ang);return[J[i][0]+rx,J[i][1]+ry];};
    const p=seg(best),n=bt>.5&&best<cd.spine.length-2?seg(best+1):bt<.5&&best>0?seg(best-1):p,k=bt>.5?(bt-.5):(.5-bt);o[0]=p[0]+(n[0]-p[0])*k*.5;o[1]=p[1]+(n[1]-p[1])*k*.5;},D.hides?.[cd.layer]??[]);
  });
 }
 get state(){return{emotion:this.emotion,face:{...this.face},gesture:{...this.gesture}};}
}
