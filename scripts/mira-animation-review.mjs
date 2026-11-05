import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer as createPortProbe} from 'node:net';
import {createServer} from 'vite';
import {temporaryDatabase} from './database-test.ts';
const work=path.resolve('artifacts/work/royal-bar-mira/animation-check-20261105');
fs.mkdirSync(work,{recursive:true});
if(!fs.existsSync(path.join(work,'owner.json')))fs.writeFileSync(path.join(work,'owner.json'),JSON.stringify({owner:'mira-animation-review',purpose:'Complete local host with isolated backend for Mira animation regression checks',cleanup:'Stop this stand and its owned disposable database after review; remove transient test outputs.'},null,2)+'\n');
const port=5202,apiPort=5203;
for(const checkPort of [port,apiPort]){
  const probe=createPortProbe();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(checkPort,'127.0.0.1',()=>probe.close(resolve));});
}
const database=await temporaryDatabase();
const log=fs.openSync(path.join(work,'backend.log'),'w');
const backend=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore',log,log],env:{...process.env,...database.env,AUTH_DB_PATH:'mira_animation_audit',PORT:String(apiPort),PUBLIC_ORIGIN:'http://127.0.0.1:'+port,CODEX_SALE_API_KEY:'',A6API_KEY:'',NOWPAYMENTS_ENABLED:'false',NOWPAYMENTS_GAMES_ENABLED:'false',NOWPAYMENTS_WITHDRAWALS_ENABLED:'false',CASINOAPIPRO_ENABLED:'false',NILE_PLAY_SOCKET_FILE:''}});fs.closeSync(log);
let vite,stopping=false;
async function stop(){if(stopping)return;stopping=true;await vite?.close();if(backend.exitCode===null){backend.kill();await new Promise(resolve=>{backend.once('exit',resolve);setTimeout(resolve,5000);});}await database.cleanup();}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop().then(()=>process.exit(0)));
process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{if(data.trim()==='stop')void stop().then(()=>process.exit(0));});
const hook=`
const mountMiraAudit=()=>{
if(!room.bar){setTimeout(mountMiraAudit,25);return;}
let auditPose,hideAuditActors=false,hideMira=false;
room.events.on('postupdate',()=>{if(hideAuditActors)for(const actor of [room.player,...room.guests.values()]){actor.sprite.setVisible(false);actor.shadow.setVisible(false);actor.label?.setVisible(false);actor.blush?.setVisible(false);}});
room.events.on('postupdate',()=>{for(const name of ['mira-painted-body','mira-painted-front'])room.children.getByName(name)?.setVisible(!hideMira);});
const regularMiraUpdate=room.bar.update.bind(room.bar);
room.bar.update=(...args)=>{if(!auditPose)return regularMiraUpdate(...args);Object.assign(room.bar.view,auditPose);room.bar.rig.render(auditPose,args[1],room.time.now,args[3]);};
Object.assign(window,{royalMiraAudit:{
 pose:view=>{auditPose=view;}, normal:()=>{auditPose=undefined;},
 focus:()=>{const c=room.cameras.main;c.stopFollow().setZoom(Math.min(2.6,(c.width-30)/350,(c.height-30)/280)).centerOn(275,420);},
 layers:()=>room.children.list.filter(o=>o.name?.includes('mira')||o.name?.includes('royal-bar')||o.name==='cat-water-mug').map(o=>({name:o.name,depth:o.depth,visible:o.visible})),
 actors:visible=>{hideAuditActors=!visible;},
 showMira:visible=>{hideMira=!visible;},
 legacyProps:value=>{for(const name of ['glass','flowers','coffee','lemons','board']){const object=room.children.getByName('royal-bar-prop-'+name);object?.setDepth(value?509:510.5);if(name==='glass'||name==='lemons')object?.setVisible(!value);}},
 pixels:async(points)=>new Promise(resolve=>room.game.renderer.snapshot(image=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);const data=c.getImageData(0,0,canvas.width,canvas.height).data;const camera=room.cameras.main;const scaleX=canvas.width/room.game.scale.width,scaleY=canvas.height/room.game.scale.height;resolve(points.map(([x,y])=>{const px=Math.floor((x-camera.worldView.x)*camera.zoom*scaleX),py=Math.floor((y-camera.worldView.y)*camera.zoom*scaleY);const offset=(py*canvas.width+px)*4;return Array.from(data.slice(offset,offset+4));}));})),
}});
};mountMiraAudit();
`;
try{
 let healthy=false;for(let i=0;i<200;i++){if(backend.exitCode!==null)throw Error('Audit backend exited');healthy=fs.readFileSync(path.join(work,'backend.log'),'utf8').includes('Royal server listening on port '+apiPort)&&await fetch('http://127.0.0.1:'+apiPort+'/healthz').then(r=>r.ok).catch(()=>false);if(healthy)break;await new Promise(r=>setTimeout(r,200));}if(!healthy)throw Error('Audit backend health timeout');
 vite=await createServer({configFile:false,root:process.cwd(),cacheDir:'node_modules/.vite-mira-animation-audit',plugins:[{name:'mira-audit-observability',enforce:'pre',
 resolveId(source){if(source.endsWith('/public/assets/cat/walk-v3-frames.json'))return '\0mira-audit-cat-frame-data';},
 load(id){if(id==='\0mira-audit-cat-frame-data')return 'export default '+fs.readFileSync('public/assets/cat/walk-v3-frames.json','utf8');},
 transform(source,id){if(id.replaceAll('\\','/').endsWith('/src/main.ts'))return source.replace('Object.assign(window, { royalDemo:',hook+'\nObject.assign(window, { royalDemo:');}}],server:{host:'127.0.0.1',port,strictPort:true,watch:{ignored:['**/module-dist/**','**/module-build/**','**/artifacts/**']},proxy:{'/api':'http://127.0.0.1:'+apiPort,'/multiplayer':{target:'http://127.0.0.1:'+apiPort,ws:true,rewrite:p=>p.replace(/^\/multiplayer/,'')}}}});
 await vite.listen();fs.writeFileSync(path.join(work,'stand-identity.json'),JSON.stringify({pid:process.pid,backendPid:backend.pid,databaseDirectory:database.directory,webPort:port,apiPort,productionDataUsed:false},null,2)+'\n');
 console.log('Mira audit full host: http://127.0.0.1:'+port+'/?offline=1');
}catch(error){await stop();throw error;}
