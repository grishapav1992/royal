import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const folder=new URL('../public/assets/caribbean-treasures/',import.meta.url);
await mkdir(folder,{recursive:true});
const exports=[['harbor',1600,85],['captain',720,88],['captain-win',720,88],['frame',1536,90],
 ...['map','compass','pistol','cutlass','ruby','parrot'].map(name=>['symbol-'+name,768,90])];
for(const [name,width,quality] of exports){
 await sharp(fileURLToPath(new URL('../games/caribbean-treasures/assets/source/'+name+'.png',import.meta.url))).resize(width).webp({quality}).toFile(fileURLToPath(new URL(name+'.webp',folder)));
}
