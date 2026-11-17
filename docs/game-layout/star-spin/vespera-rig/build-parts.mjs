import sharp from 'sharp';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const out = dirname(fileURLToPath(import.meta.url));
const root = resolve(out, '../../../..');
const source = resolve(root, 'games/wild-nudge/assets/characters/vespera.png');
const sha = b => createHash('sha256').update(b).digest('hex');
const W = 1024, H = 1536;
// Anatomical right is on the left side of the reference image.
// These contours partition visible source pixels. They do not invent hidden anatomy.
const cuts = [
  ['hand_l', [590,568], 'forearm_l', 'Кисть на бедре', [[492,519],[519,510],[546,516],[567,536],[591,550],[615,571],[612,592],[588,600],[553,591],[540,578],[521,579],[503,588],[488,580],[505,560],[490,558],[478,566],[467,555],[481,543],[494,538],[481,536]]],
  ['hand_r', [263,742], 'forearm_r', 'Кисть с мечом', [[248,718],[279,729],[291,757],[280,788],[278,818],[267,831],[255,815],[243,819],[238,805],[226,805],[222,786],[231,755]]],
  ['cape_clasp', [548,306], 'torso', 'Застёжка плаща', [[542,278],[551,290],[573,301],[558,310],[550,337],[539,321],[521,311],[530,297]]],
  ['head', [463,247], 'torso', 'Голова и шея', [[392,105],[409,71],[446,58],[493,62],[535,81],[557,107],[565,142],[550,177],[545,210],[531,230],[505,243],[498,263],[476,284],[442,276],[422,249],[422,222],[401,207],[390,175],[395,143]]],
  ['saber_hilt', [257,803], 'hand_r', 'Рукоять меча', [[294,706],[321,712],[306,751],[293,768],[285,810],[269,845],[246,871],[214,855],[230,815],[249,778],[272,740]]],
  ['saber_blade', [231,857], 'saber_hilt', 'Клинок и свечение', [[215,832],[255,851],[96,1255],[43,1267],[35,1224]]],
  ['forearm_l', [718,492], 'upper_arm_l', 'Левое предплечье', [[684,473],[715,463],[741,476],[745,494],[730,518],[699,544],[660,570],[619,596],[592,582],[597,559],[632,537],[655,514]]],
  ['upper_arm_l', [640,400], 'torso', 'Левое плечо', [[600,367],[672,389],[714,438],[735,473],[702,500],[675,476],[646,444],[621,418]]],
  ['forearm_r', [308,585], 'upper_arm_r', 'Правое предплечье', [[287,565],[318,570],[330,587],[316,621],[297,653],[280,690],[277,727],[252,739],[237,717],[249,672],[263,622]]],
  ['upper_arm_r', [334,389], 'torso', 'Правое плечо', [[314,368],[349,376],[357,420],[350,464],[343,504],[333,546],[322,578],[305,602],[283,582],[291,548],[302,520],[303,478],[300,443]]],
  ['tabard', [417,623], 'pelvis', 'Передняя ткань', [[392,617],[440,611],[453,684],[471,807],[486,949],[509,1108],[480,1157],[429,1119],[411,1004],[401,872],[395,737]]],
  ['boot_r', [220,1344], 'shin_r', 'Правый сапог', [[187,1277],[246,1275],[275,1318],[257,1375],[244,1418],[243,1487],[223,1507],[176,1512],[126,1506],[119,1486],[147,1458],[165,1411],[177,1357]]],
  ['boot_l', [682,1343], 'shin_l', 'Левый сапог', [[630,1275],[683,1271],[713,1309],[714,1375],[716,1419],[737,1460],[737,1508],[689,1519],[646,1508],[633,1473],[637,1420],[626,1371]]],
  ['knee_r', [305,1010], 'thigh_r', 'Правый наколенник', [[295,946],[322,951],[345,972],[351,1002],[331,1039],[325,1072],[306,1090],[277,1076],[261,1055],[264,1016],[277,976]]],
  ['knee_l', [630,1015], 'thigh_l', 'Левый наколенник', [[597,964],[631,952],[660,974],[675,1007],[671,1052],[651,1090],[622,1092],[600,1065],[586,1024]]],
  ['shin_r', [296,1074], 'knee_r', 'Правая голень', [[264,1035],[328,1059],[333,1087],[312,1155],[287,1220],[262,1283],[246,1336],[201,1353],[177,1325],[191,1269],[218,1190],[241,1120]]],
  ['shin_l', [639,1071], 'knee_l', 'Левая голень', [[590,1047],[666,1049],[685,1100],[696,1176],[705,1256],[712,1322],[692,1358],[638,1347],[620,1304],[605,1214],[597,1132]]],
  ['thigh_r', [365,762], 'pelvis', 'Правое бедро', [[336,721],[407,744],[419,788],[402,847],[375,910],[342,975],[318,1001],[277,990],[279,940],[286,875],[301,802]]],
  ['thigh_l', [545,756], 'pelvis', 'Левое бедро', [[474,738],[560,719],[602,757],[624,827],[649,905],[664,970],[650,997],[604,1007],[571,965],[551,894],[526,835],[497,798]]],
  ['pelvis', [442,625], 'root', 'Таз и пояс', [[358,581],[409,579],[464,564],[516,567],[558,592],[590,635],[624,704],[625,770],[599,802],[554,810],[503,783],[464,758],[423,793],[382,803],[330,798],[312,766],[324,702],[340,635]]],
  ['cape_shoulder', [566,291], 'torso', 'Наплечная складка плаща', [[327,317],[382,303],[423,285],[483,286],[516,278],[555,266],[603,257],[647,269],[673,298],[697,335],[725,380],[750,431],[766,480],[726,476],[688,449],[651,426],[612,402],[585,366],[556,334],[518,321],[474,319],[426,332],[374,345]]],
  ['torso', [453,598], 'pelvis', 'Корпус', [[410,244],[453,245],[481,262],[487,288],[522,302],[555,322],[577,359],[576,404],[558,456],[538,507],[533,546],[553,580],[529,610],[464,631],[399,628],[359,608],[359,567],[347,519],[325,482],[306,452],[308,412],[320,364],[350,332],[395,308],[418,286]]],
  ['hair_back', [455,63], 'head', 'Хвост и задние волосы', [[226,6],[578,5],[582,258],[560,306],[526,285],[488,273],[446,300],[411,340],[383,399],[344,463],[305,515],[251,526],[225,401],[236,252]]],
];

await mkdir(resolve(out, 'source-parts'), {recursive:true});
await mkdir(resolve(out, 'aligned'), {recursive:true});
await mkdir(resolve(out, 'parts'), {recursive:true});
const srcFile = await readFile(source);
const src = await sharp(srcFile).ensureAlpha().raw().toBuffer();
const owners = new Int16Array(W*H).fill(cuts.length);
for (let i=0; i<cuts.length; i++) {
  const points = cuts[i][4].map(p => p.join(',')).join(' ');
  const mask = await sharp(Buffer.from(`<svg width="${W}" height="${H}"><polygon points="${points}" fill="white"/></svg>`)).ensureAlpha().raw().toBuffer();
  for(let p=0;p<owners.length;p++) if(owners[p]===cuts.length && mask[p*4+3]>=128) owners[p]=i;
}
const manifest = {version:1, character:'Darth Vespera', game:'Star Spin', source:'games/wild-nudge/assets/characters/vespera.png', sourceSha256:sha(srcFile), canvas:{width:W,height:H}, sideConvention:'Anatomical right is viewer left', sourceParts:[], reconstructedParts:[], sourceVerification:{}};
const all = [...cuts, ['cape_back',[582,304],'root','Задний плащ и оставшиеся края',[]]];
const reconstructed = Buffer.alloc(src.length);
for(let i=0;i<all.length;i++) {
  const [id,pivot,parent,label] = all[i];
  const raw = Buffer.alloc(src.length);
  let minX=W,minY=H,maxX=0,maxY=0,count=0;
  for(let p=0;p<owners.length;p++) if(owners[p]===i && src[p*4+3]) {
    src.copy(raw,p*4,p*4,p*4+4); src.copy(reconstructed,p*4,p*4,p*4+4);
    const x=p%W,y=Math.floor(p/W); minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);count++;
  }
  if(!count) throw Error(`Empty source part ${id}`);
  const left=Math.max(0,minX-3),top=Math.max(0,minY-3),width=Math.min(W,maxX+4)-left,height=Math.min(H,maxY+4)-top;
  const png=await sharp(raw,{raw:{width:W,height:H,channels:4}}).png().toBuffer();
  await writeFile(resolve(out,`aligned/${id}.png`),png);
  const trimmed=await sharp(png).extract({left,top,width,height}).png().toBuffer();
  await writeFile(resolve(out,`source-parts/${id}.png`),trimmed);
  manifest.sourceParts.push({id,label,parent,file:`source-parts/${id}.png`,alignedFile:`aligned/${id}.png`,x:left,y:top,width,height,pivotCanvas:pivot,pivotLocal:[pivot[0]-left,pivot[1]-top],visiblePixels:count,sha256:sha(trimmed),kind:'original-visible-pixels',hiddenSurfacesRestored:false});
}
let difference=0;
for(let p=0;p<W*H;p++) if(src[p*4+3]) for(let c=0;c<4;c++) difference=Math.max(difference,Math.abs(src[p*4+c]-reconstructed[p*4+c]));
manifest.sourceVerification={maximumVisibleChannelDifference:difference,eachVisiblePixelAssignedExactlyOnce:true};
await sharp(reconstructed,{raw:{width:W,height:H,channels:4}}).png().toFile(resolve(out,'assembled-source.png'));

// Independent painted textures: uniform cells are cropped, then transparent padding is trimmed.
// They are not claimed to preserve the reference pixel-for-pixel or share a common scale.
const sheets = [
  {file:'sheets/upper.png',cols:3,rows:3,ids:['head','torso','pelvis','upper_arm_r','forearm_r','hand_r','upper_arm_l','forearm_l','hand_l'],gutter:0},
  {file:'sheets/lower.png',cols:2,rows:3,ids:['thigh_r','thigh_l','shin_r','shin_l','boot_r','boot_l'],gutter:0,regions:[[0,0,627,423],[627,0,1254,429],[0,423,627,850],[627,429,1254,846],[0,850,627,1254],[627,846,1254,1254]]},
  {file:'sheets/accessories.png',cols:2,rows:2,ids:['cape_back','hair_back','tabard','saber'],gutter:0,regions:[[0,0,623,622],[631,0,1254,622],[0,631,623,1254],[631,631,1254,1254]]},
];
for(const s of sheets) {
  const input=await readFile(resolve(out,s.file)), meta=await sharp(input).metadata();
  for(let i=0;i<s.ids.length;i++) {
    const col=i%s.cols,row=Math.floor(i/s.cols),g=s.gutter;
    const region=s.regions?.[i] || [Math.floor(col*meta.width/s.cols)+g,Math.floor(row*meta.height/s.rows)+g,Math.floor((col+1)*meta.width/s.cols)-g,Math.floor((row+1)*meta.height/s.rows)-g];
    const [left,top,right,bottom]=region,width=right-left,height=bottom-top;
    const cell=await sharp(input).extract({left,top,width,height}).png().toBuffer();
    const pixels=await sharp(cell).raw().toBuffer();
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) if((x===0||y===0||x===width-1||y===height-1)&&pixels[(y*width+x)*4+3]>80) throw Error(`Crop intersects visible texture: ${s.ids[i]}`);
    const trimmed=await sharp(cell).trim({background:'#00000000',threshold:8}).png().toBuffer();
    const png=await sharp(trimmed).extend({top:8,bottom:8,left:8,right:8,background:'#00000000'}).png().toBuffer();
    const m=await sharp(png).metadata(), id=s.ids[i];
    await writeFile(resolve(out,`parts/${id}.png`),png);
    manifest.reconstructedParts.push({id,file:`parts/${id}.png`,width:m.width,height:m.height,sha256:sha(png),kind:'imagegen-reconstructed',sourceSheet:s.file,sourceCell:{column:col,row},placement:'Fit to source reference and set joints before binding; scales differ between cells'});
  }
}
const esc=t=>t.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
// Embedded PNGs make the SVG portable and keep all original source layers editable.
const embedded=[];
for(const part of [...manifest.sourceParts].reverse()) {
  const data=(await readFile(resolve(out,part.file))).toString('base64');
  embedded.push(`<g id="${part.id}"><title>${esc(part.label)}</title><image x="${part.x}" y="${part.y}" width="${part.width}" height="${part.height}" href="data:image/png;base64,${data}"/></g>`);
}
await writeFile(resolve(out,'vespera-layered.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${embedded.join('\n')}</svg>\n`);
const bones=manifest.sourceParts.map(p=>{const parent=manifest.sourceParts.find(v=>v.id===p.parent);return `${parent?`<line x1="${parent.pivotCanvas[0]}" y1="${parent.pivotCanvas[1]}" x2="${p.pivotCanvas[0]}" y2="${p.pivotCanvas[1]}" stroke="#52ecff" stroke-width="3"/>`:''}<circle cx="${p.pivotCanvas[0]}" cy="${p.pivotCanvas[1]}" r="6" fill="#ffe77c"/><text x="${p.pivotCanvas[0]+10}" y="${p.pivotCanvas[1]-7}" fill="white" stroke="#12202c" stroke-width="3" paint-order="stroke" font-family="sans-serif" font-size="16">${p.id}</text>`;});
await writeFile(resolve(out,'rig-map.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#26323e"/><image href="data:image/png;base64,${srcFile.toString('base64')}" width="${W}" height="${H}" opacity="0.75"/>${bones.join('')}</svg>\n`);
await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');

async function overview(parts,file,title) {
  const cw=270,ch=340,cols=4,rows=Math.ceil(parts.length/cols),width=cw*cols,height=rows*ch+85;
  const svg=Buffer.from(`<svg width="${width}" height="${height}"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#384351"/><path d="M0 0h12v12H0zM12 12h12v12H12z" fill="#414d5c"/></pattern></defs><rect width="100%" height="100%" fill="#1b2530"/><text x="24" y="42" font-family="sans-serif" font-size="25" fill="white">${esc(title)}</text>${parts.map((p,i)=>`<rect x="${(i%cols)*cw+8}" y="${Math.floor(i/cols)*ch+65}" width="${cw-16}" height="${ch-10}" rx="12" fill="url(#grid)"/><text x="${(i%cols)*cw+20}" y="${Math.floor(i/cols)*ch+92}" font-family="sans-serif" font-size="17" fill="white">${i+1}. ${p.id}</text>`).join('')}</svg>`);
  const layers=[];
  for(let i=0;i<parts.length;i++) {
    const thumb=await sharp(resolve(out,parts[i].file)).resize({width:cw-38,height:ch-65,fit:'inside',withoutEnlargement:true}).png().toBuffer();
    const m=await sharp(thumb).metadata();layers.push({input:thumb,left:(i%cols)*cw+Math.floor((cw-m.width)/2),top:Math.floor(i/cols)*ch+110+Math.floor((ch-65-m.height)/2)});
  }
  await sharp(svg).composite(layers).png().toFile(resolve(out,file));
}
await overview(manifest.reconstructedParts,'parts-overview.png','Darth Vespera: 19 reconstructed rig textures');
await overview(manifest.sourceParts,'source-overview.png','Darth Vespera: 24 original-pixel layers');
console.log(JSON.stringify({originalParts:manifest.sourceParts.length,reconstructedParts:manifest.reconstructedParts.length,maximumSourceDifference:difference}));
