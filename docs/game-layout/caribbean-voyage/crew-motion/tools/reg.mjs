import sharp from 'sharp';
// similarity registration: place m1 (w x h) into the master canvas
export async function register(refFile,movFile,init,opt={}){const D=opt.D??4,W=1024/D,H=1536/D;
 const ref=await sharp(refFile).ensureAlpha().flatten({background:'#fff'}).resize(W,H).greyscale().raw().toBuffer();
 const mov=await sharp(movFile).ensureAlpha().flatten({background:'#fff'}).resize(512,768).greyscale().raw().toBuffer();
 const cost=(sx,sy,tx,ty)=>{let e=0,n=0;for(let y=20;y<H*.62;y+=2)for(let x=10;x<W-10;x+=2){const u=(x*D-tx)/(1024*sx)*512,v=(y*D-ty)/(1536*sy)*768;if(u<2||v<2||u>509||v>765)continue;const iu=u|0,iv=v|0,fu=u-iu,fv=v-iv,a=mov[iv*512+iu]*(1-fu)+mov[iv*512+iu+1]*fu,b=mov[(iv+1)*512+iu]*(1-fu)+mov[(iv+1)*512+iu+1]*fu;e+=Math.abs(a*(1-fv)+b*fv-ref[y*W+x]);n++;}return e/n;};
 let best=[...init,cost(...init)],step=[.02,.02,12,12];
 for(let it=0;it<60;it++){let ok=false;for(let k=0;k<4;k++)for(const s of [-1,1]){const t=best.slice(0,4);t[k]+=s*step[k];const c=cost(...t);if(c<best[4]){best=[...t,c];ok=true;}}if(!ok){step=step.map(x=>x/1.7);if(step[2]<.1)break;}}
 return best;}
if(process.argv[2]){console.log(await register(process.argv[2],process.argv[3],[.881,.881,25,5]));}
