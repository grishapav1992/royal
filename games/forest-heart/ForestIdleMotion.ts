/** Shared small idle deformation. The face moves as a whole; no eye image is substituted. */
export const forestIdleMotion = `
vec2 forestIdleShift(vec2 uv,float time){
  float hair=smoothstep(.55,.77,uv.x)*smoothstep(.14,.34,uv.y)*(1.-smoothstep(.74,.99,uv.y));
  float cloth=smoothstep(.62,.96,uv.y)*smoothstep(.06,.26,abs(uv.x-.5));
  float breath=exp(-pow((uv.y-.41)/.16,2.))*exp(-pow((uv.x-.5)/.23,2.));
  vec2 shift=vec2(hair*.004*sin(time*.83+uv.y*8.)+cloth*.003*sin(time*.67+uv.y*6.)+breath*(uv.x-.5)*.009*sin(time*1.25),-breath*.0018*sin(time*1.25));
  float head=1.-smoothstep(.25,.39,uv.y);
  float tilt=.006*sin(time*.43)+.003*sin(time*.19+1.);
  vec2 neck=uv-vec2(.51,.27);
  shift+=(mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*neck-neck)*head;
  shift.x+=.0008*sin(time*.41)*exp(-pow((uv.y-.34)/.12,2.));
  return shift;
}`;
