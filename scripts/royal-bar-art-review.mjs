import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {readHostProjection} from './build-host-projection.mjs';

const root=process.cwd(),reader=await readHostProjection(root,'deployment/releases/royal-bar-mira-20261104-v1/host-projection.json');
reader.preload(Object.keys(reader.metadata.files));
const hook=`
    const reviewCamera=()=>this.cameras.main.stopFollow().setZoom(1.65).centerOn(275,465);
    let reviewGuests=true;
    Object.assign(window,{royalBarArtReview:{focus:reviewCamera,setGuests:value=>{reviewGuests=value;for(const actor of this.guests.values()){const visible=value&&actor.hall===this.hall;actor.sprite.setVisible(visible);actor.shadow.setVisible(visible);actor.label?.setVisible(visible);if(!value)actor.blush.setVisible(false);}},catMug:()=>{const mug=this.children.getByName('cat-water-mug');return {present:!!mug,visible:mug?.visible,depth:mug?.depth};}}});
    this.events.on(Phaser.Scenes.Events.POST_UPDATE,()=>{if(!reviewGuests)for(const actor of this.guests.values()){actor.sprite.setVisible(false);actor.shadow.setVisible(false);actor.blush.setVisible(false);actor.label?.setVisible(false);}});
    this.time.delayedCall(500,reviewCamera);
`;
const banner=`<aside id="bar-art-review" style="position:fixed;z-index:100000;left:12px;bottom:48px;max-width:460px;padding:10px 14px;border:1px solid #bd934f;border-radius:8px;background:#211724ed;color:#f1d296;font:13px Arial;box-shadow:0 4px 24px #0008">Визуальный макет v2. Новая Мира пока неподвижна.<div style="margin-top:8px;display:flex;gap:8px"><button onclick="window.royalBarArtReview?.focus()">Приблизить бар</button><button onclick="this.dataset.hidden=this.dataset.hidden==='yes'?'no':'yes';window.royalBarArtReview?.setGuests(this.dataset.hidden!=='yes');this.textContent=this.dataset.hidden==='yes'?'Показать НПС':'Скрыть НПС для сравнения'">Скрыть НПС для сравнения</button></div></aside>`;
const server=await createServer({root,configFile:false,plugins:[{name:'reviewed-bar-art-prototype',enforce:'pre',
 load(id){
  if(id.startsWith('\0'))return;
  const file=path.relative(root,id.split('?')[0]).replaceAll('\\','/');
  if(file.startsWith('../')||file.includes('node_modules/')||!/\.(?:ts|js|mjs|cjs|json|css)$/.test(file))return;
  if(file==='src/game/Bar.ts')return fs.readFileSync('src/game/BarArtworkReview.ts','utf8');
  let source=reader.read(file).toString();
  if(file==='src/game/RoomScene.ts')source=source.replace('preload() {',`preload() {
    this.load.image('reference-bar-assembly','/assets/royal-bar/v2/bar-assembly.png');
    this.load.image('reference-mira-seated','/assets/royal-bar/v2/mira-seated.png');
    this.load.image('reference-bar-stool','/assets/royal-bar/v2/bar-stool.png');
  `).replace("this.showHall('arcade');","this.showHall('arcade');"+hook);
  return source;
 },
 transformIndexHtml:{order:'pre',handler(){return reader.read('index.html').toString().replace('</body>',banner+'</body>');}}
}],server:{host:'127.0.0.1',port:5198,strictPort:true,watch:{ignored:['**/module-dist/**','**/module-build/**','**/artifacts/**']},proxy:{'/api':{target:'http://127.0.0.1:5197'}}}});
await server.listen();console.log('Royal Bar static artwork review: http://127.0.0.1:5198/?offline=1');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close().then(()=>process.exit(0)));
