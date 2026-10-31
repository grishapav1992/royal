import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {digest} from '../../../scripts/module-build-cache.mjs';
import {publicationFacts,verifyHttp} from './verify-public.mjs';

const encode=value=>Buffer.from(JSON.stringify(value)+'\n');
async function fixture(t){
 const folder=await mkdtemp(join(tmpdir(),'royal-public-verification-'));
 t.after(()=>rm(folder,{recursive:true,force:true}));
 const artifacts={'dist/index.html':Buffer.from('<script src="/assets/host.js"></script>'),
  'dist/assets/host.js':Buffer.from('reviewed client'), 'dist/assets/host.css':Buffer.from('body{}'),
  'dist/assets/retained.js':Buffer.from('retained client'),'dist-server/index.js':Buffer.from('reviewed backend')};
 const official={format:1,clean:true,scope:'application',sourceCommit:'a'.repeat(40),baseCommit:'b'.repeat(40),build:{passed:true},
  files:Object.fromEntries(Object.entries(artifacts).map(([name,bytes])=>[name,digest(bytes)]))};
 const officialBytes=encode(official),receiptBytes=encode({sourceCommit:official.sourceCommit});
 const operator={release:'universal-spins-20261031-v1',sourceCommit:official.sourceCommit,baseCommit:official.baseCommit,
  releaseManifestSha256:digest(officialBytes),receiptSha256:digest(receiptBytes),serverDelta:{'index.js':official.files['dist-server/index.js']},
  delta:Object.fromEntries(['index.html','assets/host.js','assets/host.css'].map(name=>[name,official.files['dist/'+name]])),
  before:{program:{'dist/assets/retained.js':official.files['dist/assets/retained.js']}}};
 await mkdir(join(folder,'dist-delta/assets'),{recursive:true});await mkdir(join(folder,'server-delta'));
 for(const name of Object.keys(operator.delta))await writeFile(join(folder,'dist-delta',name),artifacts['dist/'+name]);
 await writeFile(join(folder,'server-delta/index.js'),artifacts['dist-server/index.js']);
 await writeFile(join(folder,'release-manifest.json'),officialBytes);await writeFile(join(folder,'release-github.json'),receiptBytes);
 await writeFile(join(folder,'install-manifest.json'),encode(operator));
 return{folder,artifacts,official,operator};
}
function guestRequest(artifacts,calls,change=()=>null){
 return async(url,options)=>{
  const path=new URL(url).pathname;calls.push({path,...options});const changed=change(path,options);if(changed)return changed;
  if(path==='/')return new Response(artifacts['dist/index.html']);
  if(path.startsWith('/assets/'))return new Response(artifacts['dist'+path]);
  if(path==='/healthz')return Response.json({ok:true});
  if(path==='/api/auth/me')return Response.json({account:null});
  return Response.json({error:'Guest denied'},{status:['/api/game-wallet','/api/nile-play/wallet'].includes(path)?410:401});
 };
}

test('checks every official client file and guest boundary without account or gameplay writes',async t=>{
 const {folder,artifacts}=await fixture(t),facts=await publicationFacts(folder),calls=[];
 const report=await verifyHttp(facts,{origin:'https://example.test',request:guestRequest(artifacts,calls)});
 assert.equal(report.passed,true);assert.equal(report.httpFiles,4);assert.equal(report.deniedGuestPosts,1);
 assert.deepEqual(calls.filter(call=>call.method!=='GET').map(call=>[call.method,call.path,call.body]),[['POST','/api/progression/spins','{}']]);
 assert(calls.every(call=>call.credentials==='omit'&&call.redirect==='manual'&&!call.headers?.Cookie&&!call.headers?.Authorization));
 assert.equal(report.productionAccountsCreated+report.productionStakes+report.productionMessages,0);
});

test('rejects changed package bytes, missing retained facts and symlinked artifacts before requests',async t=>{
 const {folder,operator}=await fixture(t);
 delete operator.before.program['dist/assets/retained.js'];await writeFile(join(folder,'install-manifest.json'),encode(operator));
 await assert.rejects(publicationFacts(folder),/neither scoped nor retained/);
 operator.before.program['dist/assets/retained.js']=digest('retained client');await writeFile(join(folder,'install-manifest.json'),encode(operator));
 await writeFile(join(folder,'dist-delta/assets/host.js'),'changed');await assert.rejects(publicationFacts(folder),/Scoped client file changed/);
 await rm(join(folder,'dist-delta/assets/host.js'));await symlink('../index.html',join(folder,'dist-delta/assets/host.js'));
 await assert.rejects(publicationFacts(folder),/symlink rejected/);
});

test('a stale public bundle stops verification before any endpoint or POST',async t=>{
 const {folder,artifacts}=await fixture(t),calls=[];
 const report=await verifyHttp(await publicationFacts(folder),{origin:'https://example.test',
  request:guestRequest(artifacts,calls,path=>path==='/assets/host.js'?new Response('stale'):null)});
 assert.equal(report.passed,false);assert.match(report.errors[0],/Public client bytes differ/);
 assert(calls.every(call=>call.method==='GET'&&!call.path.startsWith('/api/')));
});

test('unexpected authenticated guest or accepted guest spin fails verification',async t=>{
 const {folder,artifacts}=await fixture(t),facts=await publicationFacts(folder);
 for(const path of ['/api/auth/me','/api/progression/spins']){
  const report=await verifyHttp(facts,{origin:'https://example.test',request:guestRequest(artifacts,[],actual=>actual===path?
   Response.json({account:{id:'unexpected'}}):null)});
  assert.equal(report.passed,false);assert(report.errors[0].includes(path==='/api/auth/me'?'Guest unexpectedly':'Guest endpoint status'));
 }
});

test('rejects non-HTTPS, credentialed or path-bearing origins without requests',async()=>{
 for(const origin of ['http://example.test','https://user:pass@example.test','https://example.test/path']){
  await assert.rejects(verifyHttp({},{origin,request:()=>{throw Error('A request must not be made');}}),/bare HTTPS origin/);
 }
});
