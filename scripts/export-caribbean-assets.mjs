import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const folder=new URL('../public/assets/caribbean-treasures/',import.meta.url);
await mkdir(folder,{recursive:true});
for(const [name,width,quality] of [['harbor',1600,85],['captain',720,88],['captain-win',720,88]]){
 await sharp(fileURLToPath(new URL('../games/caribbean-treasures/assets/source/'+name+'.png',import.meta.url))).resize(width).webp({quality}).toFile(fileURLToPath(new URL(name+'.webp',folder)));
}
