import {templePoses,type TemplePose,type TempleReaction} from './character';
import type {PortraitMotion} from './CharacterMotion';

// A small textured mesh moves the shoulders, head and lantern while keeping boots planted.
// It is illustration animation, not a skeletal 3D character or a physics simulation.
const vertex=String.raw`
attribute vec2 a_uv;
varying vec2 v_uv;
uniform float u_time,u_energy,u_look,u_gesture;
uniform mediump float u_motion,u_rig;
uniform vec4 u_head,u_body,u_arms;
float band(float y,float a,float b,float c,float d){return smoothstep(a,b,y)*(1.0-smoothstep(c,d,y));}
vec2 turn(vec2 p,vec2 pivot,float angle){float c=cos(angle),s=sin(angle);vec2 q=p-pivot;return pivot+vec2(c*q.x-s*q.y,s*q.x+c*q.y);}
void main(){
  v_uv=a_uv;vec2 p=a_uv;
  if(u_rig>.5){
    float upper=1.0-smoothstep(.58,.84,a_uv.y);
    float torso=band(a_uv.y,.16,.28,.56,.8);
    p.x+=(p.x-.5)*torso*u_body.z*.009*u_motion;
    p.y-=torso*u_body.z*.002*u_motion;
    float right=smoothstep(.59,.71,a_uv.x)*band(a_uv.y,.19,.25,.39,.47);
    p=turn(p,vec2(.66,.24),-u_arms.x*.14*right*u_motion);
    float hand=band(a_uv.x,.56,.62,.73,.79)*band(a_uv.y,.33,.37,.43,.48);
    p.y-=hand*u_arms.x*.007*u_motion;
    float left=(1.0-smoothstep(.37,.44,a_uv.x))*band(a_uv.y,.19,.27,.76,.81);
    p=turn(p,vec2(.39,.235),u_arms.y*.11*left*u_motion);
    float lantern=(1.0-smoothstep(.35,.42,a_uv.x))*band(a_uv.y,.49,.53,.73,.77);
    p=turn(p,vec2(.245,.54),u_arms.z*.055*lantern*u_motion);
    float head=1.0-smoothstep(.185,.255,a_uv.y);
    p=turn(p,vec2(.53,.205),u_head.z*.065*head*u_motion);
    p.x+=head*u_head.x*.008*u_motion;
    p.y+=head*u_head.y*.012*u_motion;
    float hair=(1.0-smoothstep(.38,.5,a_uv.x))*band(a_uv.y,.04,.08,.25,.34);
    p.x+=hair*sin(u_time*1.25+.5)*.002*u_motion;
    p.x+=upper*u_body.x*.04*u_motion;p.y-=upper*u_body.y*.018*u_motion;
    // Space for the head and hands is inside the existing canvas, not under the board.
    p=vec2(.5,.99)+(p-vec2(.5,.99))*vec2(.96,.97);
    gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0,1);return;
  }
  float torso=band(p.y,.16,.28,.52,.72);
  float upper=1.0-smoothstep(.45,.86,p.y);
  float breath=sin(u_time*1.55);
  p.x+=(p.x-.5)*torso*breath*.005*u_motion;
  p.y-=torso*(breath+1.0)*.0018*u_motion;
  p.x+=upper*(sin(u_time*.51)*.002+u_gesture*u_energy*.009)*u_motion;
  float head=1.0-smoothstep(.15,.24,p.y);
  float angle=(sin(u_time*.74)*.004+u_look*.008+u_gesture*u_energy*.012)*head*u_motion;
  vec2 h=p-vec2(.51,.2);p=vec2(.51,.2)+mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*h;
  float lantern=(1.0-smoothstep(.31,.43,a_uv.x))*band(a_uv.y,.24,.35,.69,.79);
  p.x+=lantern*sin(u_time*.96+.6)*.0035*u_motion;
  p.y-=upper*u_gesture*u_energy*.004*u_motion;
  gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0,1);
}`;
const fragment=String.raw`
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_from,u_to;
uniform float u_mix,u_rig,u_motion;
uniform vec4 u_face;
float oval(vec2 uv,vec2 center,vec2 radius){vec2 q=(uv-center)/radius;return 1.0-smoothstep(.55,1.0,dot(q,q));}
void main(){
  vec2 uv=v_uv,lidUV=v_uv;float lash=0.0,lid=0.0;
  if(u_rig>.5&&u_motion>.5){
    vec2 eyeA=vec2(.4992,.1057),eyeB=vec2(.5559,.0961);
    vec2 tiltedA=vec2(v_uv.x,v_uv.y+.18*(v_uv.x-eyeA.x));
    vec2 tiltedB=vec2(v_uv.x,v_uv.y+.18*(v_uv.x-eyeB.x));
    float a=oval(tiltedA,eyeA,vec2(.021,.0065)),b=oval(tiltedB,eyeB,vec2(.020,.0065));
    vec2 center=a>b?eyeA:eyeB;
    float eye=max(a,b),slope=.18*(v_uv.x-center.x),closure=smoothstep(.12,.8,u_face.x);
    uv.x-=eye*u_face.z*.0015;
    // Cover the eye with nearby skin instead of stretching the painted iris or eyebrow.
    lidUV=vec2(v_uv.x,center.y+.012-slope);lid=eye*closure;
    float curve=.0015*(1.0-pow(clamp((v_uv.x-center.x)/.021,-1.0,1.0),2.0));
    lash=eye*(1.0-smoothstep(.0005,.0012,abs(v_uv.y+slope-center.y-curve)))*closure*.75;
    float mouth=oval(v_uv,vec2(.539,.137),vec2(.034,.014));
    uv.y+=mouth*u_face.y*min(1.0,abs(v_uv.x-.539)/.022)*.002;
  }
  vec4 a=texture2D(u_from,uv),b=texture2D(u_to,uv);
  vec4 p=mix(vec4(a.rgb*a.a,a.a),vec4(b.rgb*b.a,b.a),u_mix);
  vec3 color=p.a>.0001?p.rgb/p.a:vec3(0);
  if(lid>0.0)color=mix(color,texture2D(u_from,lidUV).rgb*.97,lid);
  gl_FragColor=vec4(mix(color,vec3(.13,.075,.05),lash),p.a);
}`;

export class TemplePortrait{
  readonly canvas:HTMLCanvasElement;
  private gl:WebGLRenderingContext|null=null;
  private program?:WebGLProgram;
  private buffer?:WebGLBuffer;
  private textures=new Map<TemplePose,WebGLTexture>();
  private images=new Map<TemplePose,HTMLImageElement>();
  private uniforms:Record<string,WebGLUniformLocation|null>={};
  private count=0;
  private disposed=false;
  private ready=false;
  private fallback:HTMLImageElement;
  private pose:TemplePose='idle';
  private lost=(event:Event)=>{event.preventDefault();this.ready=false;this.canvas.hidden=true;this.fallback.hidden=false;};
  private restored=()=>{if(!this.disposed){this.initialize();this.invalidate();}};
  constructor(private parent:HTMLElement,private invalidate:()=>void){
    const doc=parent.ownerDocument;
    this.canvas=doc.createElement('canvas');this.canvas.className='ft-portrait';this.canvas.width=512;this.canvas.height=768;this.canvas.setAttribute('aria-hidden','true');this.canvas.hidden=true;
    this.fallback=doc.createElement('img');this.fallback.className='ft-portrait ft-portrait-fallback';this.fallback.alt='';this.fallback.draggable=false;this.fallback.setAttribute('aria-hidden','true');this.fallback.src='/assets/flooded-temple/character/idle.webp';
    parent.append(this.fallback,this.canvas);this.canvas.addEventListener('webglcontextlost',this.lost);this.canvas.addEventListener('webglcontextrestored',this.restored);
    for(const pose of templePoses){const img=doc.createElement('img');img.onload=()=>{if(this.disposed)return;this.upload(pose,img);this.invalidate();};img.onerror=()=>{if(!this.disposed)this.invalidate();};this.images.set(pose,img);img.src='/assets/flooded-temple/character/'+pose+'.webp';}
    this.initialize();
  }
  private shader(gl:WebGLRenderingContext,kind:number,source:string){const shader=gl.createShader(kind);if(!shader)throw Error('Portrait shader unavailable');gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw Error('Portrait shader compilation failed');}return shader;}
  private initialize(){
    try{
      const gl=this.canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,depth:false,stencil:false});if(!gl)return;this.gl=gl;this.textures.clear();
      const vs=this.shader(gl,gl.VERTEX_SHADER,vertex),fs=this.shader(gl,gl.FRAGMENT_SHADER,fragment),program=gl.createProgram();if(!program){gl.deleteShader(vs);gl.deleteShader(fs);return;}
      gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);this.program=program;
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Portrait program linking failed');
      gl.useProgram(program);const uv:number[]=[],cols=24,rows=48;
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)uv.push(x/cols,y/rows,(x+1)/cols,y/rows,x/cols,(y+1)/rows,x/cols,(y+1)/rows,(x+1)/cols,y/rows,(x+1)/cols,(y+1)/rows);
      this.count=uv.length/2;this.buffer=gl.createBuffer()??undefined;if(!this.buffer)throw Error('Portrait buffer unavailable');gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(uv),gl.STATIC_DRAW);
      const at=gl.getAttribLocation(program,'a_uv');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
      for(const name of ['time','motion','energy','look','gesture','mix','from','to','rig','head','body','arms','face'])this.uniforms[name]=gl.getUniformLocation(program,'u_'+name);
      gl.uniform1i(this.uniforms.from,0);gl.uniform1i(this.uniforms.to,1);gl.viewport(0,0,512,768);gl.clearColor(0,0,0,0);
      for(const [pose,img]of this.images)if(img.complete&&img.naturalWidth)this.upload(pose,img);
    }catch{this.release();this.gl=null;this.ready=false;this.canvas.hidden=true;this.fallback.hidden=false;}
  }
  private upload(pose:TemplePose,img:HTMLImageElement){
    const gl=this.gl;if(!gl||gl.isContextLost()||!this.program)return;
    const texture=gl.createTexture();if(!texture)return;this.textures.set(pose,texture);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
  }
  draw(from:TemplePose,to:TemplePose,mix:number,reaction:TempleReaction,timeMs:number,gesture:number,motion:boolean,rig?:PortraitMotion){
    if(this.disposed)return;this.pose=to;
    const gl=this.gl,target=this.textures.get(to),previous=this.textures.get(from)??target;
    if(!gl||gl.isContextLost()||!target||!previous||!this.program){const url=this.images.get(to)?.naturalWidth?this.images.get(to)!.src:this.images.get('idle')!.src;if(this.fallback.src!==url)this.fallback.src=url;return;}
    this.ready=true;this.canvas.hidden=false;this.fallback.hidden=true;
    gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,previous);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,target);
    gl.uniform1f(this.uniforms.rig,rig?1:0);
    if(rig){gl.uniform4f(this.uniforms.head,rig.gaze,rig.nod,rig.tilt,0);gl.uniform4f(this.uniforms.body,rig.lean,rig.lift,rig.breath,0);gl.uniform4f(this.uniforms.arms,rig.rightArm,rig.leftArm,rig.lantern,0);gl.uniform4f(this.uniforms.face,rig.blink,rig.smile,rig.gaze,0);}
    gl.uniform1f(this.uniforms.time,timeMs/1000);gl.uniform1f(this.uniforms.motion,motion?1:0);gl.uniform1f(this.uniforms.energy,reaction.energy);gl.uniform1f(this.uniforms.look,reaction.look);gl.uniform1f(this.uniforms.gesture,gesture);gl.uniform1f(this.uniforms.mix,mix);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,this.count);
  }
  private release(){const gl=this.gl;if(!gl)return;for(const texture of this.textures.values())gl.deleteTexture(texture);this.textures.clear();if(this.buffer)gl.deleteBuffer(this.buffer);if(this.program)gl.deleteProgram(this.program);this.buffer=undefined;this.program=undefined;}
  getState(){return {renderer:this.ready?'mesh':'image',pose:this.pose,textures:this.textures.size,loaded:[...this.images].filter(([,img])=>img.complete&&img.naturalWidth>0).map(([pose])=>pose),disposed:this.disposed};}
  destroy(){if(this.disposed)return;this.disposed=true;this.canvas.removeEventListener('webglcontextlost',this.lost);this.canvas.removeEventListener('webglcontextrestored',this.restored);for(const img of this.images.values()){img.onload=null;img.onerror=null;}this.images.clear();this.release();this.gl?.getExtension('WEBGL_lose_context')?.loseContext();this.gl=null;this.ready=false;this.canvas.remove();this.fallback.remove();}
}
