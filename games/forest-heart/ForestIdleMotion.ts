/** Subtle native breathing, hair and cloth. Video frames never use this deformation. */
export const forestIdleMotion = `
vec2 forestIdleShift(vec2 uv,float time){
  float hair=smoothstep(.55,.77,uv.x)*smoothstep(.14,.34,uv.y)*(1.-smoothstep(.74,.99,uv.y));
  float cloth=smoothstep(.62,.96,uv.y)*smoothstep(.06,.26,abs(uv.x-.5));
  float breath=exp(-pow((uv.y-.41)/.16,2.))*exp(-pow((uv.x-.5)/.23,2.));
  vec2 shift=vec2(hair*.004*sin(time*.83+uv.y*8.)+cloth*.003*sin(time*.67+uv.y*6.)+breath*(uv.x-.5)*.009*sin(time*1.25),-breath*.0018*sin(time*1.25));
  return shift;
}`;
