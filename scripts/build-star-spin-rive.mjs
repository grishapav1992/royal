import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const root=resolve(import.meta.dirname,'..');
const cli=process.env.ROYAL_RIVE_CLI||resolve(homedir(),'.rive/versions/1.7.0',process.platform==='win32'?'rive.exe':'rive');
const sha=value=>createHash('sha256').update(value).digest('hex');
const run=(args)=>new Promise((accept,reject)=>{const child=spawn(cli,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',reject);child.on('exit',code=>code===0?accept(out):reject(Error(`Rive ${args.join(' ')} failed (${code}): ${err+out}`)));});
const version=(await run(['--version'])).trim();if(version!=='rive 1.7.0')throw Error('Use the verified Rive CLI 1.7.0 for this source');
const rigs=JSON.parse(await readFile(resolve(root,'games/wild-nudge/animation/rigs.json'),'utf8'));
const selected=process.argv.includes('--character')?process.argv[process.argv.indexOf('--character')+1]:undefined;
if(selected&&!rigs.characters.some(c=>c.id===selected))throw Error('Unknown character');
for(const config of rigs.characters.filter(c=>!selected||c.id===selected))await build(config);
async function build(config){
const id=config.id,project=resolve(root,'games/wild-nudge/animation/'+id);
await mkdir(project,{recursive:true});
const modes=['idle','spin_wait','wild_align','bonus_enter','bonus_idle','round_win','select'];
const W=640,H=960,nx=20,ny=30,points=[],map=new Map();
function point(x,y){const key=x+':'+y;if(!map.has(key)){map.set(key,points.length);points.push({x:x*W/nx,y:y*H/ny,boundary:x===0||y===0||x===nx||y===ny});}return map.get(key);}
for(let x=0;x<=nx;x++)point(x,0);for(let y=1;y<=ny;y++)point(nx,y);for(let x=nx-1;x>=0;x--)point(x,ny);for(let y=ny-1;y>0;y--)point(0,y);for(let y=1;y<ny;y++)for(let x=1;x<nx;x++)point(x,y);
const gauss=(x,y,cx,cy,rx,ry)=>Math.exp(-2*((x-cx)**2/rx**2+(y-cy)**2/ry**2));
function weights({x,y}){
 if(y>config.anchorY||((x-config.face[0])/config.face[2])**2+((y-config.face[1])/config.face[3])**2<1)return[255,0,0,0,0];
 const field=parts=>Math.max(...parts.map(([cx,cy,rx,ry])=>gauss(x,y,cx,cy,rx,ry)));const dynamic=[.72*field(config.body),.96*field(config.hair),.88*field(config.cloth),.99*field(config.limb)];
 const sum=dynamic.reduce((a,b)=>a+b,0),scaled=sum>.96?dynamic.map(v=>v*.96/sum):dynamic;
 const raw=[Math.max(0,1-scaled.reduce((a,b)=>a+b,0)),...scaled],selected=raw.map((weight,bone)=>({weight,bone})).sort((a,b)=>b.weight-a.weight).slice(0,4),total=selected.reduce((a,b)=>a+b.weight,0);
 const out=Array(5).fill(0);let used=0;for(let i=0;i<selected.length;i++){const value=i===selected.length-1?255-used:Math.floor(selected[i].weight/total*255);out[selected[i].bone]=value;used+=value;}if(out.some(v=>v<0||v>255)||out.reduce((a,b)=>a+b,0)!==255)throw Error('Invalid skin weights');return out;
}
const wp=points.map(weights),groups=Array.from({length:5},()=>[]);
for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)for(const tri of [[point(x,y),point(x+1,y),point(x+1,y+1)],[point(x,y),point(x+1,y+1),point(x,y+1)]]){
 const sum=Array(5).fill(0);for(const i of tri)wp[i].forEach((v,b)=>sum[b]+=v);const max=Math.max(...sum);groups[sum.indexOf(max)].push(...tri);
}
function varints(values){const bytes=[];for(let v of values){while(v>=128){bytes.push((v&127)|128);v>>>=7;}bytes.push(v);}return Buffer.from(bytes).toString('base64');}
function packed(values){const nonzero=values.map((v,b)=>[v,b]).filter(([v])=>v),indices=nonzero.reduce((n,[,b],slot)=>n+((b+1)*2**(slot*8)),0),weights=nonzero.reduce((n,[v],slot)=>n+v*2**(slot*8),0);return{indices,values:weights};}
const partNames=['Anchored pose and face','Breathing torso',id==='aeliri'?'Head tendrils':'Hair strands','Cloth and cape',id==='lyra'?'Force hand':id==='aeliri'?'Floating saber':id==='vespera'?'Hip arm':'Combat grip'];
const mesh=groups.map((triangles,part)=>`<Image originX="0" originY="0" assetId="0:300" name="${partNames[part]}"><Mesh triangleIndexBytes="${varints(triangles)}" name="${partNames[part]} mesh">${points.map((p,i)=>{const type=p.boundary?'ContourMeshVertex':'MeshVertex',w=packed(wp[i]);return`<${type} x="${p.x}" y="${p.y}" u="${p.x/W}" v="${p.y/H}"><Weight values="${w.values}" indices="${w.indices}"/></${type}>`;}).join('')}<Skin name="Registered image skin">${partNames.map((name,i)=>`<Tendon boneId="0:${10+i}" name="${name}"/>`).join('')}</Skin></Mesh></Image>`).join('\n');
const key=(frame,value,ease=true)=>`<KeyFrameDouble frame="${frame}" value="${Number(value.toFixed(6))}" interpolationType="${ease?'cubic':'linear'}">${ease?'<CubicEaseInterpolator/>':''}</KeyFrameDouble>`;
const prop=(name,values)=>`<KeyedProperty property="${name}">${values.map(([f,v])=>key(f,v)).join('')}</KeyedProperty>`;
const obj=(id,values)=>`<KeyedObject objectId="0:${id}">${Object.entries(values).map(([p,v])=>prop(p,v)).join('')}</KeyedObject>`;
const condition=value=>`<TransitionViewModelCondition opValue="equal"><TransitionPropertyViewModelComparator><BindablePropertyNumber><DataBindContext sourcePathIds="0:200-0:201" propertyKey="636"/></BindablePropertyNumber></TransitionPropertyViewModelComparator><TransitionValueNumberComparator value="${value}"/></TransitionViewModelCondition>`;
const machine=`<StateMachine name="Character" id="0:50"><StateMachineLayer name="Reactions" id="0:51"><AnyState x="-160" y="-150"/><ExitState x="1100" y="-150"/><EntryState x="-160" y="0"><StateTransition stateToId="0:60"/></EntryState>${modes.map((_,i)=>`<AnimationState animationId="0:${100+i}" id="0:${60+i}" x="${i%4*220}" y="${Math.floor(i/4)*200}" reset="true">${modes.map((__,j)=>i===j?'':`<StateTransition stateToId="0:${60+j}" duration="240">${condition(j)}</StateTransition>`).join('')}</AnimationState>`).join('')}</StateMachineLayer></StateMachine>`;
const animation=modes.map((name,mode)=>{
 const loop=[0,1,4].includes(mode),duration=loop?config.duration:90,peak=duration*.4,amp=[1,.7,1.1,1.5,1.2,1.25,.9][mode];
 const wave=(value)=>[[0,0],[duration*.25,value],[duration*.5,0],[duration*.75,-value*.65],[duration,0]].map(([f,v])=>[Math.round(f),v]);
 const breathe=loop?wave(-2*amp):[[0,0],[Math.round(peak),-2*amp],[duration,0]],hair=loop?wave(3.4*amp*config.hairAmplitude):[[0,0],[25,5*amp*config.hairAmplitude],[60,-1*amp*config.hairAmplitude],[duration,0]],cape=loop?wave(5*amp*config.clothAmplitude):[[0,0],[30,8*amp*config.clothAmplitude],[60,-2*amp*config.clothAmplitude],[duration,0]];
 const hand=mode<2||mode===4?wave(.003*config.limbAmplitude):[[0,0],[30,-.035*amp*config.limbAmplitude],[55,-.02*amp*config.limbAmplitude],[duration,0]],[px,py]=config.pivot;
 const blink=loop?[[0,0],[duration*.413,0],[duration*.427,1],[duration*.433,1],[duration*.447,0],[duration*.90,0],[duration*.913,1],[duration*.927,0],[duration,0]].map(([f,v])=>[Math.round(f),v]):[[0,0],[44,0],[48,1],[50,1],[54,0],[duration,0]];
 return`<LinearAnimation name="${name}" id="0:${100+mode}" fps="60" duration="${duration}" loopValue="${loop?'loop':'oneShot'}">${obj(11,{y:breathe,scaleX:breathe.map(([f,y])=>[f,1-y*.0015]),x:breathe.map(([f,y])=>[f,config.body[0][0]*y*.0015])})}${obj(12,{x:hair,y:hair.map(([f,v])=>[f,-v*.3])})}${obj(13,{x:cape,y:cape.map(([f,v])=>[f,-v*.4])})}${obj(14,{rotation:hand,x:hand.map(([f,r])=>[f,px-Math.cos(r)*px+Math.sin(r)*py]),y:hand.map(([f,r])=>[f,py-Math.sin(r)*px-Math.cos(r)*py])})}${obj(30,{opacity:blink})}</LinearAnimation>`;
}).join('\n');
const scene=`<Rive version="1" kind="fragment"><Artboard styleId="0:3" width="640" height="960" name="${config.artboard}" id="0:2" defaultStateMachineId="0:50" viewModelId="0:200" viewModelInstanceId="0:202"><LayoutComponentStyle name="Character style" id="0:3"/>${partNames.map((name,i)=>`<RootBone x="0" y="0" length="12" name="${name}" id="0:${10+i}"/>`).join('')}<Image originX="0" originY="0" x="${config.eyelids.left*.625}" y="${config.eyelids.top*.625}" opacity="0" assetId="0:301" name="Closed eyelids" id="0:30"/>${mesh}${machine}${animation}</Artboard><ViewModel name="Character" id="0:200" defaultInstanceId="0:202"><ViewModelPropertyNumber name="mode" id="0:201"/><ViewModelInstance name="Default" id="0:202" exports="true"><ViewModelInstanceNumber propertyValue="0" viewModelPropertyId="0:201"/></ViewModelInstance></ViewModel><ImageAsset file="../../../../public/assets/wild-nudge/characters/${id}.webp" name="${config.artboard} texture" id="0:300"/><ImageAsset file="eyelids.png" name="${config.artboard} closed eyelids" id="0:301"/></Rive>\n`;
await sharp(resolve(project,'blink-reference.png')).extract(config.eyelids).resize({width:Math.round(config.eyelids.width*.625)}).png().toFile(resolve(project,'eyelids.png'));
await writeFile(resolve(project,'scene.rml'),scene);
console.log(await run([project,'--verify','--format=json']));
const inspection=await run(['inspect',project,'--summary']);console.log(inspection);if(JSON.parse(inspection).problems?.length)throw Error('Resolve Rive inspection problems before exporting');
await run([project,'--once']);
await run([project,'--screenshot','--advance=1']);
const bytes=await readFile(resolve(project,'build/'+id+'.riv'));
const sources=['scripts/build-star-spin-rive.mjs','games/wild-nudge/animation/rigs.json',`games/wild-nudge/animation/${id}/scene.rml`,`games/wild-nudge/animation/${id}/eyelids.png`,`games/wild-nudge/animation/${id}/blink-reference.png`,`public/assets/wild-nudge/characters/${id}.webp`];
const sourceHashes=Object.fromEntries(await Promise.all(sources.map(async file=>[file,sha(/\.(?:mjs|rml|json)$/.test(file)?(await readFile(resolve(root,file),'utf8')).replace(/\r\n/g,'\n'):await readFile(resolve(root,file)))])));
const output=resolve(root,`public/assets/wild-nudge/characters/${id}-rive.json`);await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({format:'royal-rive-v1',character:id,cliVersion:'1.7.0',sha256:sha(bytes),sourceHashes,artboard:config.artboard,stateMachine:'Character',viewModel:'Character',modeProperty:'mode',modes,bytes:bytes.length,data:bytes.toString('base64')}));
console.log(JSON.stringify({character:id,vertices:points.length,meshes:groups.length,bones:partNames.length,modes,bytes:bytes.length,output}));

}
const wasm=await readFile(resolve(root,'node_modules/@rive-app/webgl2/rive.wasm'));
const licenseText=(await readFile(resolve(root,'games/wild-nudge/animation/RIVE-LICENSE.txt'),'utf8')).replace(/\r\n/g,'\n');
await writeFile(resolve(root,'public/assets/wild-nudge/characters/rive-runtime.json'),JSON.stringify({format:'royal-rive-wasm-v1',package:'@rive-app/webgl2',version:'2.49.0',license:'MIT',licenseText,sha256:sha(wasm),bytes:wasm.length,data:wasm.toString('base64')}));
