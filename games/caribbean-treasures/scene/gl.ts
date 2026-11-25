export function loadImage(src:string){return new Promise<HTMLImageElement>((yes,no)=>{const i=new Image();i.decoding='sync';i.onload=()=>void i.decode().catch(()=>{}).then(()=>yes(i));i.onerror=()=>no(Error(src));i.src=src;});}
export function program(gl:WebGLRenderingContext,fragment:string){
  const make=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'shader');return s;};
  const p=gl.createProgram()!;
  gl.attachShader(p,make(gl.VERTEX_SHADER,'attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}'));
  gl.attachShader(p,make(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)||'link');
  gl.useProgram(p);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const at=gl.getAttribLocation(p,'a');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
  const cache=new Map<string,WebGLUniformLocation|null>();
  const u=(n:string)=>{if(!cache.has(n))cache.set(n,gl.getUniformLocation(p,n));return cache.get(n)!;};
  return {p,free:()=>{gl.getExtension('WEBGL_lose_context')?.loseContext();},set:(n:string,...x:number[])=>{const l=u(n);x.length===1?gl.uniform1f(l,x[0]):x.length===2?gl.uniform2f(l,x[0],x[1]):x.length===3?gl.uniform3f(l,x[0],x[1],x[2]):gl.uniform4f(l,x[0],x[1],x[2],x[3]);},unit:(n:string,i:number)=>gl.uniform1i(u(n),i)};
}
export function texture(gl:WebGLRenderingContext,image:TexImageSource,premultiply=false){
  const t=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
  for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);
  for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);
  return t;
}
