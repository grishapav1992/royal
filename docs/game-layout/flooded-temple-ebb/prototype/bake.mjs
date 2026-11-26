/** Technical masks and copies from the existing game artwork plus the approved-for-review heroine sketch.
 *  Usage: node bake.mjs <output folder> <heroine sketch png> */
import sharp from 'sharp';
import {mkdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const [out,hero]=process.argv.slice(2),src='../../../../public/assets/flooded-temple/',W=768,H=512;
await mkdir(out+'/assets/audio',{recursive:true});await mkdir(out+'/assets/props',{recursive:true});
// Water in the painting: blue, darker than it is grey, below the far shore. R water, G waterfalls, B fire bowls.
const px=await sharp(src+'temple.webp').resize(W,H).removeAlpha().raw().toBuffer();
const at=(x,y)=>{const i=(y*W+x)*3;return[px[i],px[i+1],px[i+2]];};
const ok=(x,y)=>{if(y<226||y>502)return false;const [r,g,b]=at(x,y);const warm=r>g+18&&r>b+6;return (b>r+14&&b>=g-12)||(warm&&r>110&&y>250&&g<r*.86&&b<r*.75&&x>80&&x<700&&reflect(x));};
// Painted fire reflections are columns inside the water; they belong to it.
const refl=[[18,60],[225,245],[308,330],[412,440],[498,530],[620,650],[180,205]];const reflect=x=>refl.some(([a,b])=>x>=a&&x<=b);
// Islands, slabs and the stair are blue-lit too, so they are cut out by hand (900x600 units of the painting).
const solid=[[[0,0],[900,0],[900,274],[0,274]],[[150,262],[440,262],[430,300],[395,312],[330,300],[300,305],[255,318],[200,330],[150,330]],[[90,270],[110,290],[175,290],[190,322],[258,338],[250,360],[205,362],[200,385],[110,395],[60,400],[60,270]],[[100,400],[150,392],[185,415],[250,420],[300,435],[270,448],[190,450],[140,470],[120,490],[80,490],[80,400]],[[425,220],[460,220],[460,300],[430,305]],[[480,220],[530,220],[530,300],[560,310],[560,250],[670,240],[700,290],[725,330],[722,360],[700,388],[560,385],[556,365],[590,350],[590,320],[480,312]],[[690,260],[760,260],[870,262],[870,405],[735,395],[740,370],[700,330]],[[660,420],[725,420],[735,470],[790,480],[900,400],[900,600],[560,600],[570,560],[640,540],[660,490]],[[0,555],[60,560],[120,580],[330,585],[330,600],[0,600]]];
const solidPx=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 900 600">'+solid.map(p=>'<polygon points="'+p.map(a=>a.join(',')).join(' ')+'" fill="#fff"/>').join('')+'</svg>')).extractChannel(3).raw().toBuffer();
const m=new Uint8Array(W*H),q=[[380,300],[250,320],[360,400],[560,400],[620,360],[130,400],[300,460],[440,340],[700,320]];
while(q.length){const [x,y]=q.pop();if(x<0||y<0||x>=W||y>=H||m[y*W+x]||!ok(x,y))continue;m[y*W+x]=1;q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}
const one=Buffer.alloc(W*H);for(let i=0;i<W*H;i++)one[i]=solidPx[i]>128?0:m[i]*255;
const water=await sharp(one,{raw:{width:W,height:H,channels:1}}).median(5).blur(2.4).linear(1.5,-120).blur(1).toColourspace('b-w').raw().toBuffer();
const rgb=Buffer.alloc(W*H*3);
// Hand-placed boxes in painting pixels of 900x600: falls and bowls.
const falls=[[438,58,458,170],[592,52,612,118],[596,184,612,242],[718,14,748,98],[785,178,806,216],[806,258,820,302],[702,364,716,390],[440,255,470,290]];
const fires=[[712,434,16],[40,430,15],[30,340,13],[138,174,13],[232,205,13],[614,256,11],[570,146,9],[628,96,8],[30,186,9]];
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*3,X=x/W*900,Y=y/H*600;rgb[i]=water[y*W+x];
 let f=0;for(const [a,b,c,d] of falls)if(X>=a&&X<=c&&Y>=b&&Y<=d){const [r,g,bl]=at(x,y);if(bl>110||r+g+bl>330)f=1;}rgb[i+1]=f*255;
 let e=0;for(const [a,b,r] of fires){const dx=(X-a)/r,dy=(Y-b)/(r*1.25);e=Math.max(e,1-dx*dx-dy*dy);}rgb[i+2]=Math.round(Math.max(0,e)*255);}
await sharp(rgb,{raw:{width:W,height:H,channels:3}}).blur(.8).webp({quality:86}).toFile(out+'/assets/temple-mask.webp');
await sharp(src+'temple.webp').webp({quality:90}).toFile(out+'/assets/temple.webp');
await sharp(src+'cascade-symbols.webp').webp({quality:92,alphaQuality:100}).toFile(out+'/assets/symbols.webp');
for(const f of ['chest','chest-open','lever','lever-pulled','relic'])await copyFile(src+'props/'+f+'.webp',out+'/assets/props/'+f+'.webp');
await copyFile(src+'frame.webp',out+'/assets/frame.webp');
// Heroine: 768x1152 sheet; the two forearms are cut into their own layers so they can swing freely.
const HW=768,HH=1152,base=await sharp(hero).resize(HW,HH).ensureAlpha().raw().toBuffer();
// Polygons in 700x1050 units of the sketch view.
const polys={lantern:[[140,512],[176,512],[206,545],[207,705],[60,705],[60,560],[120,530]],
 left:[[190,330],[206,311],[214,307],[232,310],[252,320],[270,338],[268,352],[256,380],[240,384],[224,412],[202,452],[186,500],[176,513],[138,513],[126,490],[146,440],[176,370],[186,352]],
 right:[[442,364],[466,350],[490,337],[503,348],[508,372],[520,398],[560,500],[580,545],[576,602],[510,602],[514,560],[514,522],[511,510],[496,474],[487,445],[480,420],[470,412],[452,398],[444,382]]};
const svg=p=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${HW}" height="${HH}" viewBox="0 0 700 1050"><polygon points="${p.map(a=>a.join(',')).join(' ')}" fill="#fff"/></svg>`);
const maskOf=async p=>sharp(svg(p)).blur(.7).extractChannel(3).raw().toBuffer();
const mk={};for(const k in polys)mk[k]=await maskOf(polys[k]);
const put=async(name,f)=>{const b=Buffer.from(base);for(let i=0;i<HW*HH;i++)b[i*4+3]=Math.round(b[i*4+3]*f(i)/255);await sharp(b,{raw:{width:HW,height:HH,channels:4}}).webp({quality:92,alphaQuality:100}).toFile(out+'/assets/'+name+'.webp');};
for(const k in polys)await put('hero-'+k,i=>mk[k][i]);
await put('hero-body',i=>255-Math.max(mk.lantern[i],mk.left[i],mk.right[i]));
await sharp(hero).resize(HW,HH).webp({quality:92,alphaQuality:100}).toFile(out+'/assets/hero.webp');
// Sound: the game's own recordings in a smaller container.
for(const [n,f] of Object.entries({land0:'cascadeLandA',land1:'cascadeLandB',land2:'cascadeLandC',break0:'cascadeBreakA',break1:'cascadeBreakB',bonus:'cascadeBonus',win:'win',big:'big',lever:'lever',chest:'chest',scrape:'scrape',rope:'rope',neutral:'neutral',relic:'relic',step:'step'}))
 execFileSync('ffmpeg',['-loglevel','error','-y','-i',src+'audio/'+f+'.wav','-c:a','aac','-b:a','96k','-f','mp4',out+'/assets/audio/'+n+'.mp4']);
for(const f of ['splash'])execFileSync('ffmpeg',['-loglevel','error','-y','-i','../../../../games/flooded-temple/assets/audio-source/'+f+'.wav','-c:a','aac','-b:a','96k','-f','mp4',out+'/assets/audio/'+f+'.mp4']);
execFileSync('ffmpeg',['-loglevel','error','-y','-i',src+'audio/ambience.wav','-c:a','aac','-b:a','80k','-f','mp4',out+'/assets/audio/ambience.mp4']);
