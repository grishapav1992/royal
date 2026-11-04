import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {readHostProjection} from './build-host-projection.mjs';

const root=process.cwd(),reader=await readHostProjection(root,'deployment/releases/royal-bar-mira-20261104-v1/host-projection.json');
reader.preload(Object.keys(reader.metadata.files));
const port=Number(process.env.ROYAL_BAR_PORT||5198),backend=process.env.ROYAL_BAR_API_URL||'http://127.0.0.1:5197';
const reviewUI=process.env.ROYAL_BAR_REVIEW_UI!=='0';
const hook=`
    const reviewCamera=()=>{const c=this.cameras.main;c.stopFollow().setZoom(Math.min(1.65,(c.width-24)/350,(c.height-24)/360)).centerOn(275,465);};
    let reviewGuests=true;
    let demoAction='',demoStarted=0;
    const normalBarUpdate=this.bar.update.bind(this.bar);
    this.bar.update=(...args)=>{
      if(demoAction&&document.querySelector('#bar-dialog[open]')){demoAction='';document.querySelector('[aria-label="Показать действие Миры"]').value='';}
      if(!demoAction)return normalBarUpdate(...args);
      const elapsed=this.time.now-demoStarted;
      const duration=demoAction==='serve'?3200:demoAction==='greet'?1200:4000;
      let view={x:265,y:456,facing:'down',action:demoAction,progress:(elapsed%duration)/duration};
      if(demoAction==='walk'){const t=(elapsed/4800)%2;view.x=191+143*(t<1?t:2-t);view.facing=t<1?'right':'left';view.progress=(elapsed%650)/650;}
      if(demoAction==='sit'){view.x=191;view.progress=.5;}
      if(demoAction==='wipe')view.x=334;
      if(demoAction==='stock'){view.x=335;view.y=446;view.facing='up';}
      if(demoAction==='transitions'){
        view.x=191;const t=elapsed%3400;
        if(t<600){view.action='sit';view.progress=.5;}
        else if(t<1400){view.action='stand-up';view.progress=(t-600)/800;}
        else if(t<2000){view.action='idle';view.progress=0;}
        else if(t<2800){view.action='sit-down';view.progress=(t-2000)/800;}
        else{view.action='sit';view.progress=.5;}
      }
      Object.assign(this.bar.view,view);this.bar.rig.render(view,args[1],this.time.now,args[3]);
    };
    Object.assign(window,{royalBarArtReview:{focus:reviewCamera,demo:action=>{demoAction=action;demoStarted=this.time.now;},setGuests:value=>{reviewGuests=value;for(const actor of this.guests.values()){const visible=value&&actor.hall===this.hall;actor.sprite.setVisible(visible);actor.shadow.setVisible(visible);actor.label?.setVisible(visible);if(!value)actor.blush.setVisible(false);}},catMug:()=>{const mug=this.children.getByName('cat-water-mug');return {present:!!mug,visible:mug?.visible,depth:mug?.depth};}}});
    this.events.on(Phaser.Scenes.Events.POST_UPDATE,()=>{if(!reviewGuests)for(const actor of this.guests.values()){actor.sprite.setVisible(false);actor.shadow.setVisible(false);actor.blush.setVisible(false);actor.label?.setVisible(false);}});
    this.time.delayedCall(500,reviewCamera);
`;
const banner=`<style>body:has(dialog[open]) #bar-art-review{display:none}#bar-art-review summary{cursor:pointer}</style><details id="bar-art-review" open style="position:fixed;z-index:900;right:12px;top:64px;width:calc(100vw - 52px);max-width:430px;padding:10px 14px;border:1px solid #bd934f;border-radius:8px;background:#211724ed;color:#f1d296;font:13px Arial;box-shadow:0 4px 24px #0008"><summary>Анимации Миры</summary><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button onclick="window.royalBarArtReview?.focus()">Приблизить бар</button><button onclick="this.dataset.hidden=this.dataset.hidden==='yes'?'no':'yes';window.royalBarArtReview?.setGuests(this.dataset.hidden!=='yes');this.textContent=this.dataset.hidden==='yes'?'Показать НПС':'Скрыть НПС для сравнения'">Скрыть НПС для сравнения</button><select aria-label="Показать действие Миры" onchange="window.royalBarArtReview?.demo(this.value)"><option value="">Обычная смена</option><option value="transitions">Встать и сесть</option><option value="walk">Ходьба</option><option value="wipe">Уборка стойки</option><option value="polish">Бокалы</option><option value="serve">Приготовить напиток</option><option value="greet">Приветствие</option><option value="listen">Слушать</option><option value="chat">Ответить</option><option value="stock">У полки</option><option value="sit">Отдых</option></select></div></details><script>if(matchMedia('(max-width:700px)').matches)document.getElementById('bar-art-review').open=false;</script>`;
const liveSources=new Set(['src/game/Bar.ts','src/game/MiraRig.ts','src/game/miraPose.ts','src/game/royalBarArt.ts']);
const server=await createServer({root,configFile:false,cacheDir:path.join(root,'node_modules','.vite-royal-bar-'+port),plugins:[{name:'reviewed-bar-art-prototype',enforce:'pre',
 configureServer(server){
  if(process.env.ROYAL_BAR_API_URL)return;
  let turns=[];
  server.middlewares.use((req,res,next)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(!pathname.startsWith('/api/'))return next();
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    if(pathname==='/api/npc/mira'&&req.method==='GET')return res.end(JSON.stringify({turns:turns.length?turns:[{role:'assistant',content:'Ну? Чем удивишь?'}]}));
    if(pathname==='/api/npc/mira/reset'){turns=[];return res.end('{}');}
    if(pathname==='/api/npc/mira'&&req.method==='POST'){
      let body='';req.on('data',chunk=>{body+=chunk;if(body.length>8192)req.destroy();});
      req.on('end',()=>{let message='';try{message=String(JSON.parse(body).message??'').slice(0,600);}catch{}
        const drink=/напит|лимонад|кофе|выпить/i.test(message);
        const reply=drink?'Лимонад с лимоном. Освежает и даёт повод задержаться у стойки. Будешь?':/смен/i.test(message)?'Бокалы сами себя не отполируют. Но для хорошего собеседника я могу сделать паузу. Рассказывай, как проходит твой вечер.':'Я слушаю. Только не спеши: у хороших историй всегда есть продолжение.';
        turns.push({role:'user',content:message},{role:'assistant',content:reply});turns=turns.slice(-30);
        setTimeout(()=>res.end(JSON.stringify({reply,emotion:'tease',drinkOffer:drink?'lemonade':undefined})),850);
      });return;
    }
    res.statusCode=503;res.end(JSON.stringify({error:'Локальный просмотр'}));
  });
 },
 load(id){
  if(id.startsWith('\0'))return;
  const file=path.relative(root,id.split('?')[0]).replaceAll('\\','/');
  if(file.startsWith('../')||file.includes('node_modules/')||!/\.(?:ts|js|mjs|cjs|json|css)$/.test(file))return;
  if(liveSources.has(file))return fs.readFileSync(file,'utf8');
  let source=reader.read(file).toString();
  if(file==='src/game/RoomScene.ts')source="import {preloadRoyalBarArt} from './royalBarArt';\n"+source.replace('preload() {','preload() { preloadRoyalBarArt(this);').replace("this.showHall('arcade');","this.showHall('arcade');"+(reviewUI?hook:''));
  return source;
 },
 transformIndexHtml:{order:'pre',handler(){return reader.read('index.html').toString().replace('</body>',(reviewUI?banner:'')+'</body>');}}
}],server:{host:'127.0.0.1',port,strictPort:true,watch:{ignored:['**/module-dist/**','**/module-build/**','**/artifacts/**']},proxy:{'/api':{target:backend},'/multiplayer':{target:backend,ws:true,rewrite:path=>path.replace(/^\/multiplayer/,'')}}}});
await server.listen();console.log('Royal Bar animated artwork review: http://127.0.0.1:'+port+'/?offline=1');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close().then(()=>process.exit(0)));
