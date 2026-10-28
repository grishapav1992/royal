import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const source=new URL('../games/caribbean-treasures/assets/crew/',import.meta.url);
const output=new URL('../public/assets/caribbean-treasures/crew/',import.meta.url);
const spec=JSON.parse(await readFile(new URL('prompts.json',source),'utf8'));
const poses=['idle','win','blink','focus','surprise','bonus','soft','laugh'];
const check=process.argv.includes('--check');
const inset=8;
const manifest={format:1,generator:'Built-in ImageGen',exporter:'scripts/export-caribbean-crew.mjs',width:512,height:768,atlasInset:inset,characters:[],bytes:0,budgetBytes:12*1024*1024};
await mkdir(output,{recursive:true});
const hash=data=>createHash('sha256').update(data).digest('hex');
async function save(file,data){
 if(check){const actual=await readFile(new URL(file,output));if(!actual.equals(data))throw new Error('Stale crew export: '+file);}
 else await writeFile(new URL(file,output),data);
 manifest.bytes+=data.length;return{file,bytes:data.length,sha256:hash(data)};
}
for(const character of spec.characters){
 const input=await readFile(new URL(character.source,source));
 const info=await sharp(input).metadata();
 if(!info.hasAlpha||!info.width||!info.height||info.width%4||info.height%2)throw new Error('Crew sheet must have alpha and 4 by 2 divisible dimensions: '+character.id);
 const width=info.width/4,height=info.height/2;
 const row={id:character.id,sourceSha256:hash(input),sheetWidth:info.width,sheetHeight:info.height,cellWidth:width,cellHeight:height,files:[]};
 for(let i=0;i<poses.length;i++){
  // Exclude atlas boundary pixels so adjacent frames cannot leave a hairline in game.
  const data=await sharp(input).extract({left:i%4*width+inset,top:Math.floor(i/4)*height+inset,width:width-inset*2,height:height-inset*2}).resize(512,768,{fit:'contain',background:'#00000000'}).webp({quality:86,alphaQuality:100}).toBuffer();
  row.files.push(await save(character.id+'-'+poses[i]+'.webp',data));
 }
 const thumb=await sharp(input).extract({left:inset,top:inset,width:width-inset*2,height:Math.round(height*.7)-inset*2}).resize(240,280,{fit:'contain',background:'#00000000'}).webp({quality:84,alphaQuality:100}).toBuffer();
 row.thumbnail=await save(character.id+'-thumb.webp',thumb);manifest.characters.push(row);
}
const original=await readFile(new URL('../games/caribbean-treasures/assets/source/captain.png',import.meta.url));
const originalInfo=await sharp(original).metadata();
const originalThumb=await sharp(original).extract({left:0,top:0,width:originalInfo.width,height:Math.round(originalInfo.height*.7)}).resize(240,280,{fit:'contain',background:'#00000000'}).webp({quality:84,alphaQuality:100}).toBuffer();
manifest.defaultThumbnail=await save('isabella-thumb.webp',originalThumb);
if(manifest.bytes>manifest.budgetBytes)throw new Error('Crew exceeds media budget: '+manifest.bytes);
const text=JSON.stringify(manifest,null,2)+'\n';
if(check){if(await readFile(new URL('manifest.json',output),'utf8')!==text)throw new Error('Stale crew manifest');}
else await writeFile(new URL('manifest.json',output),text);
console.log(JSON.stringify({crewExport:{characters:manifest.characters.length,frames:manifest.characters.length*8,bytes:manifest.bytes,check,output:fileURLToPath(output)}}));
