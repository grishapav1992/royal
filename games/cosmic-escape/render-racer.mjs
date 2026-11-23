import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';

const [manifest, destination, temporary, ...selected] = process.argv.slice(2);
assert.ok(manifest && destination && temporary, 'Supply a PNG pose map, the output directory and a temporary directory');
const sources = JSON.parse(await readFile(manifest, 'utf8'));
const scale = 1.6;
const width = Math.round(400 * scale);
const height = Math.round(768 * scale);
const frameMs = 50;
const idle = 'idle';
const focus = 'focus';

// [time, pose, lateral motion, vertical motion, tail follow-through].
const timelines = {
  idle: [[0,idle,0,0,0],[650,idle,-1,-2,2],[700,'blink',-1,-2,2],[850,idle,-1,-2,1],
    [1400,idle,-2,0,-1],[1750,'rest',3,2,-5],[2200,'rest',4,4,-8],[3000,'rest',3,1,-2],
    [3550,'rest',2,1,3],[3900,idle,-2,2,5],[4550,idle,-1,0,-3],[5600,idle,0,0,0]],
  focus: [[0,focus,0,0,0],[450,focus,3,1,-1],[900,focus,4,0,-2],[1350,focus,2,-1,1],[1800,focus,0,0,0]],
  calm: [[0,focus,0,0,0],[150,'calm',-1,2,-2],[550,'calm',-2,5,-2],[1100,'calm',-1,3,1],[1450,idle,0,0,0],[1600,idle,0,0,0]],
  win: [[0,focus,0,0,0],[100,focus,-2,2,1],[150,'win',3,-5,-3],[400,'win',2,2,2],
    [600,'win',1,-1,0],[1350,'win',1,0,0],[1550,idle,0,0,0],[1800,idle,0,0,0]],
  'big-win': [[0,focus,0,0,0],[150,focus,-4,4,2],[200,'big-win',5,-11,-5],[400,'big-win',1,-3,3],
    [600,'big-win',4,-8,-4],[850,'big-win',1,-3,2],[1600,'big-win',0,-2,0],[1950,idle,0,0,0],[2400,idle,0,0,0]],
  bonus: [[0,focus,0,0,0],[100,focus,-3,2,2],[150,'bonus',5,-7,-5],[450,'bonus',4,-3,2],
    [750,'bonus',3,-2,0],[1550,'bonus',2,-1,0],[1900,idle,0,0,0],[2150,idle,0,0,0]],
  even: [[0,idle,0,0,0],[100,idle,0,-2,-1],[150,'even',1,3,1],[325,'even',1,7,2],
    [550,'even',0,1,-1],[750,idle,0,-1,0],[1100,idle,0,0,0]],
  energy: [[0,focus,0,0,0],[100,'energy',1,3,-2],[250,'energy',3,5,-4],[500,'energy',2,3,1],
    [750,'energy',1,1,0],[900,'energy',1,1,0]],
  wild: [[0,focus,0,0,0],[50,'wild',-6,5,4],[200,'wild',-3,3,-4],[350,'wild',-2,-1,2],
    [650,'wild',-1,0,0],[850,'wild',-1,0,0]],
  echo: [[0,focus,0,0,0],[100,'echo',4,-2,-3],[300,'echo',6,1,-3],[500,'echo',4,0,1],
    [800,'echo',3,0,0],[1050,'echo',3,0,0]],
};
const loops = new Set([idle, focus]);
const chosen = Object.entries(timelines).filter(([name]) => !selected.length || selected.includes(name));
assert.ok(chosen.length, 'No matching animation names');
await mkdir(destination, {recursive: true});
await mkdir(temporary, {recursive: true});

const data = {};
const required = new Set(chosen.flatMap(([cue, track]) => [cue, ...track.map(([,pose]) => pose)]));
for (const name of required) {
  const sprite = sharp(sources[name]);
  const {width: sourceWidth, height: sourceHeight, hasAlpha} = await sprite.metadata();
  assert.ok(sourceWidth === 1024 && sourceHeight === 1536 && hasAlpha, 'Unaligned pose canvas: ' + name);
  const left = Math.round(8 * scale);
  const top = Math.round(25 * scale);
  const bottom = Math.round(20 * scale);
  const normalized = await sprite.extract({left:104,top:0,width:816,height:1536})
    .resize({width:width-2*left,height:height-top-bottom,fit:'fill'})
    .extend({left,right:left,top,bottom,background:'#00000000'}).png().toBuffer();
  data[name] = 'data:image/png;base64,' + normalized.toString('base64');
  if (Object.hasOwn(timelines, name)) {
    await sharp(normalized).webp({quality:96,alphaQuality:100,smartSubsample:true}).toFile(join(destination, name+'-still.webp'));
  }
}

// During the idle weight transfer, map one pose at a time to the same intermediate
// silhouette. Aligned row controls keep the feet, jacket and face in register.
const restRows = [
  [0,0,[75,118,160,200,238,280],[75,116,156,200,238,280]],
  [52,54,[78,113,158,185,218,269],[68,104,145,181,219,269]],
  [98,101,[78,102,128,169,209,251],[70,89,120,171,215,251]],
  [141,144,[62,84,119,166,209,258],[52,70,106,167,216,258]],
  [183,190,[63,83,116,144,204,245],[49,62,128,157,210,253]],
  [224,227,[68,82,111,132,190,253],[50,69,126,149,196,261]],
  [264,276,[71,88,110,138,195,248],[52,65,129,154,207,267]],
  [307,312,[72,95,108,133,174,252],[56,115,135,156,188,284]],
  [351,362,[76,95,107,138,194,258],[82,124,143,166,209,285]],
  [402,415,[78,97,111,153,198,250],[99,139,155,167,208,261]],
  [434,448,[85,103,120,156,208,249],[111,134,151,168,216,252]],
  [477,485,[89,114,131,163,221,247],[91,111,135,165,223,247]],
  [535,539,[77,96,115,156,219,237],[75,96,115,156,220,238]],
  [594,595,[70,92,111,158,228,252],[70,92,111,158,228,251]],
  [664,664,[69,89,111,161,233,260],[69,89,111,161,233,260]],
  [768,768,[60,90,115,158,235,276],[60,90,115,158,235,276]],
];

const browser = await chromium.launch({channel:'chrome'});
try {
  const page = await browser.newPage();
  await page.evaluate(async ({data,width,height,scale,restRows}) => {
    const images = {};
    for (const [name, url] of Object.entries(data)) {
      const image = new Image();
      image.src = url;
      await image.decode();
      images[name] = image;
    }
    const canvas = new OffscreenCanvas(width,height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const mix = (a,b,t) => a+(b-a)*t;
    const clamp = t => Math.max(0,Math.min(1,t));
    const smooth = t => clamp(t)**2*(3-2*clamp(t));
    const fixed = Math.round(576 * scale);
    const anchor = row => smooth((576-row/scale)/480);
    const tailOffset = row => smooth((row/scale-48)/128)*smooth((325-row/scale)/65);

    function paint(image, x, y, tail) {
      for (let row=0; row<fixed; row++) {
        const source = row-y*anchor(row);
        if (source<0 || source>=height-1) continue;
        const left = Math.round(x*anchor(row));
        const bend = Math.round(tail*tailOffset(row));
        if (bend) {
          const division = Math.round(scale*(153-56*smooth((row/scale-108)/68)));
          ctx.drawImage(image,0,source,division,1,left+bend,row,division-bend,1);
          ctx.drawImage(image,division,source,width-division,1,left+division,row,width-division,1);
        } else {
          ctx.drawImage(image,0,source,width,1,left,row,width,1);
        }
      }
      ctx.drawImage(image,0,fixed,width,height-fixed,0,fixed,width,height-fixed);
    }

    function paintRest(weight, x, y, tail) {
      const resting = weight >= .5;
      const image = images[resting ? 'rest' : 'idle'];
      const rows = restRows.map(([a,b,left,right]) => ({
        y:scale*mix(a,b,weight), sampleY:scale*(resting?b:a),
        xs:[0,...left.map((line,i)=>scale*mix(line,right[i],weight)),width],
        sampleX:[0,...(resting?right:left).map(line=>scale*line),width],
      }));
      let segment = 0;
      for (let row=0; row<height; row++) {
        const inset = Math.max(0,row-y*anchor(row));
        while (segment+2<rows.length && inset>=rows[segment+1].y) segment++;
        const a = rows[segment], b = rows[segment+1];
        const dy = clamp((inset-a.y)/(b.y-a.y));
        const sample = Math.min(height-1,mix(a.sampleY,b.sampleY,dy));
        const endpoints = a.xs.map((value,i) => {
          const point=mix(value,b.xs[i],dy);
          return Math.round(point+x*anchor(row)+tail*tailOffset(row)*smooth((138-point/scale)/76));
        });
        const source = a.sampleX.map((value,i)=>mix(value,b.sampleX[i],dy));
        for (let i=1;i<endpoints.length;i++) {
          ctx.drawImage(image,source[i-1],sample,source[i]-source[i-1],1,
            endpoints[i-1],row,endpoints[i]-endpoints[i-1],1);
        }
      }
    }

    globalThis.exportFrames = async (cue, samples) => {
      const payloads=[];
      for (const {time,pose,x,y,tail} of samples) {
        ctx.clearRect(0,0,width,height);
        const transfer = cue==='idle' ? Math.min(smooth((time-1400)/650),smooth((4200-time)/650)) : 0;
        if (transfer>0 && transfer<1) paintRest(transfer,x*scale,y*scale,tail*scale);
        else paint(images[transfer===1?'rest':pose],x*scale,y*scale,tail*scale);
        const blob=await canvas.convertToBlob({type:'image/png'});
        const bytes=new Uint8Array(await blob.arrayBuffer());
        let binary='';
        for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        payloads.push(btoa(binary));
      }
      return payloads;
    };
  }, {data,width,height,scale,restRows});

  for (const [cue, track] of chosen) {
    const samples = [];
    const duration = track.at(-1)[0];
    let last;
    let segment = 0;
    for (let time=0;time<duration;time+=frameMs) {
      while (time>=track[segment+1][0]) segment++;
      const a=track[segment], b=track[segment+1];
      const t=(time-a[0])/(b[0]-a[0]);
      const eased=t*t*(3-2*t);
      const [x,y,tail]=a.slice(2).map((value,i)=>Math.round(value+(b[i+2]-value)*eased));
      const key=[a[1],x,y,tail].join('/');
      const transferring=cue==='idle'&&(time>1400&&time<2050||time>3550&&time<4200);
      if (last && last.key===key && !transferring && !last.transferring) {
        last.delay+=frameMs;
      } else {
        last={time,pose:a[1],x,y,tail,key,transferring,delay:frameMs};
        samples.push(last);
      }
    }
    const temporaryFrames=await mkdtemp(join(resolve(temporary),'racer-'));
    try {
      const args=['-loop',loops.has(cue)?'0':'1','-lossy','-q','90','-m','4','-sharp_yuv'];
      for (let start=0;start<samples.length;start+=8) {
        const slice=samples.slice(start,start+8);
        const encoded=await page.evaluate(({cue,slice})=>globalThis.exportFrames(cue,slice),{cue,slice});
        await Promise.all(encoded.map((frame,i)=>writeFile(join(temporaryFrames,String(start+i)+'.png'),Buffer.from(frame,'base64'))));
        slice.forEach((frame,i)=>args.push('-d',String(frame.delay),join(temporaryFrames,String(start+i)+'.png')));
      }
      const filename=resolve(destination,cue+'.webp');
      execFileSync('img2webp',[...args,'-o',filename],{stdio:'inherit'});
    } finally {
      await rm(temporaryFrames,{recursive:true});
    }
  }
} finally {
  await browser.close();
}
