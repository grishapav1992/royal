// Read-only HTTPS checks for the pinned Cosmic release. No account or game operations.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const here=dirname(fileURLToPath(import.meta.url));
const GAME='studio-cosmic-escape';
const SOURCE='d3e4f9c0ef50a4d1ab63f0862696e288125fd740';
const RELEASE_SHA='e3699ee8981c9c251e663089b5dd07f78575206500b5931a6623394116ccfafe';
const EXPECTED_SHA='a28494f9c87386f58847928ab7d05b6c6bc2993742dd282a74f70206e82f6a56';
const digest=value=>createHash('sha256').update(value).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const rawPointer=pointer=>Buffer.from(JSON.stringify(pointer,null,2)+'\n');
const json=value=>{try{return JSON.parse(value.toString('utf8'));}catch{throw new Error('Response is not valid JSON');}};

function publicPath(path){
  assert.equal(typeof path,'string');
  assert(path.startsWith('/')&&!path.startsWith('//')&&!/[?#\\\s]/.test(path),'Invalid public URL path');
  assert(path==='/'||path.slice(1).split('/').every(part=>part&&part!=='.'&&part!=='..'),'Noncanonical public URL path');
  assert.equal(new URL(path,'https://verification.invalid').pathname,path,'Encoded URL path rejected');
  return path;
}

export function validateExpected(expected){
  assert.equal(expected.format,1);assert.equal(expected.gameId,GAME);
  assert.equal(expected.sourceCommit,SOURCE);assert.equal(expected.releaseManifestSha256,RELEASE_SHA);
  assert(HASH.test(expected.hostIndexSha256));
  const active=expected.cosmic,old=expected.oldCosmic;
  for(const group of [active,old]){
    assert.equal(group.gameId,GAME);assert.equal(group.metadata.gameId,GAME);assert.equal(group.version,group.metadata.version);
    assert.match(group.version,/^\d+\.\d+\.\d+-[a-f0-9]{12}$/);
    assert.equal(group.activeUrl,'/game-modules/'+GAME+'/active.json');
    assert(HASH.test(group.activePointerRawSha256)&&HASH.test(group.manifestRawSha256));
    const prefix='/game-modules/'+GAME+'/versions/'+group.version+'/';
    const manifestUrl=group===active?group.pointer.manifest:group.manifestUrl;
    assert.equal(manifestUrl,prefix+'manifest.json');
    assert.equal(group.files[manifestUrl],group.manifestRawSha256);
    assert.equal(Object.keys(group.files).length,9,'Expected exactly nine pinned version URLs');
    assert.deepEqual(Object.keys(group.files).sort(),[manifestUrl,...Object.keys(group.metadata.files).map(name=>prefix+name)].sort());
    for(const[path,hash]of Object.entries(group.files)){
      publicPath(path);assert(path.startsWith(prefix));assert(HASH.test(hash));
      if(path!==manifestUrl)assert.equal(hash,group.metadata.files[path.slice(prefix.length)]);
    }
  }
  assert.equal(active.pointer.gameId,GAME);assert.equal(active.pointer.format,1);
  assert.equal(active.pointer.sha256,active.manifestRawSha256);
  assert.deepEqual(Object.keys(active.pointer).sort(),['format','gameId','manifest','sha256']);
  assert.equal(digest(rawPointer(active.pointer)),active.activePointerRawSha256,'Pinned pointer serialization differs');
  return expected;
}

async function responseBytes(response,limit){
  const length=response.headers.get('content-length');
  if(length!==null){assert(/^\d+$/.test(length),'Invalid response length');assert(Number(length)<=limit,'Response exceeds byte limit');}
  const reader=response.body?.getReader();
  if(!reader)return Buffer.alloc(0);
  const chunks=[];let total=0;
  try{
    while(true){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;assert(total<=limit,'Response exceeds byte limit');chunks.push(Buffer.from(value));}
    return Buffer.concat(chunks,total);
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}

export async function verifyPublic({baseUrl,expected,fetchImpl=globalThis.fetch,timeoutMs=20_000,concurrency=4}){
  validateExpected(expected);
  const base=new URL(baseUrl);
  assert.equal(base.protocol,'https:');assert(!base.username&&!base.password&&!base.search&&!base.hash&&base.pathname==='/','A plain HTTPS origin is required');
  assert(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=20_000,'Timeout may not exceed 20 seconds');
  assert(Number.isInteger(concurrency)&&concurrency>0&&concurrency<=4,'Concurrency may not exceed four');
  const jobs=[{kind:'root-index',path:'/',sha256:expected.hostIndexSha256,limit:2*1024**2},
    {kind:'active-pointer',path:expected.cosmic.activeUrl,sha256:expected.cosmic.activePointerRawSha256,limit:64*1024}];
  for(const[groupName,group]of [['new',expected.cosmic],['old',expected.oldCosmic]]){
    const manifestUrl=groupName==='new'?group.pointer.manifest:group.manifestUrl;
    for(const[path,sha256]of Object.entries(group.files))jobs.push({kind:groupName+'-'+(path===manifestUrl?'manifest':'resource'),path,sha256,limit:path===manifestUrl?64*1024:64*1024**2,metadata:path===manifestUrl?group.metadata:undefined});
  }
  assert.equal(new Set(jobs.map(job=>job.path)).size,jobs.length,'Duplicate public requests');
  const started=Date.now(),checks=Array(jobs.length+2);let cursor=0;
  async function perform(job){
      const begin=Date.now();
      const check={kind:job.kind,path:job.path,passed:false};let response;
      try{
        const url=new URL(publicPath(job.path),base);assert.equal(url.origin,base.origin);
        response=await fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(timeoutMs),headers:{accept:job.kind.startsWith('health-')?'application/json':'*/*'}});
        check.status=response.status;check.cacheControl=response.headers.get('cache-control');
        assert.equal(response.status,200,'HTTP status differs from 200');assert(!response.redirected,'Redirected response rejected');
        const bytes=await responseBytes(response,job.limit);check.bytes=bytes.length;check.sha256=digest(bytes);
        if(job.sha256){check.expectedSha256=job.sha256;assert.equal(check.sha256,job.sha256,'Public file SHA-256 differs');}
        if(job.kind==='active-pointer'){
          assert(check.cacheControl?.split(',').some(value=>value.trim().toLowerCase()==='no-store'),'Active pointer must be no-store');
          assert(bytes.equals(rawPointer(expected.cosmic.pointer)),'Active pointer raw bytes differ');
          assert(isDeepStrictEqual(json(bytes),expected.cosmic.pointer),'Active pointer content differs');
        }
        if(job.kind.startsWith('health-'))assert.equal(json(bytes).ok,true,'Health response is not ok');
        if(job.metadata)assert(isDeepStrictEqual(json(bytes),job.metadata),'Module manifest metadata differs');
        check.passed=true;
      }catch(error){if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});check.error=String(error?.message||error).slice(0,240);}
      check.elapsedMs=Date.now()-begin;return check;
  }
  async function worker(){
    while(cursor<jobs.length){const index=cursor++;checks[index+1]=await perform(jobs[index]);}
  }
  checks[0]=await perform({kind:'health-before',path:'/healthz',limit:64*1024});
  await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},worker));
  checks[checks.length-1]=await perform({kind:'health-after',path:'/healthz',limit:64*1024});
  return {format:1,checkedAt:new Date().toISOString(),baseUrl:base.origin,gameId:GAME,sourceCommit:expected.sourceCommit,baseCommit:expected.baseCommit,
    releaseManifestSha256:expected.releaseManifestSha256,scope:'Read-only public HTTPS hashes, health and cache policy. Backend and guard hashes are source provenance only.',
    expectedBackendSha256:expected.backendSha256,expectedGuardSource:expected.guardSource,
    concurrency,requestTimeoutMs:timeoutMs,versionAndHostUrls:jobs.length,requests:checks.length,passed:checks.every(check=>check.passed),
    passedChecks:checks.filter(check=>check.passed).length,newVersionUrls:Object.keys(expected.cosmic.files).length,
    oldVersionUrls:Object.keys(expected.oldCosmic.files).length,elapsedMs:Date.now()-started,checks};
}

async function main(){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help'){
    console.log('Usage: node native-verify-cosmic-public.mjs --base-url https://HOST [--output RESULT.json]');return;
  }
  const options={};
  for(let index=0;index<args.length;index+=2){assert(['--base-url','--output'].includes(args[index])&&args[index+1],'Unexpected command argument');assert(!(args[index]in options),'Duplicate command option');options[args[index]]=args[index+1];}
  assert(options['--base-url'],'Explicit --base-url is required');
  const input=resolve(here,'expected-cosmic-public.json'),raw=readFileSync(input);
  assert.equal(digest(raw),EXPECTED_SHA,'Expected release artifact changed');
  const expected=json(raw),output=resolve(here,options['--output']||'native-cosmic-public-verification.json');
  assert(dirname(output)===here&&output.startsWith(here+sep)&&output.endsWith('.json')&&output!==input,'Result must remain in this task folder');
  try{const state=lstatSync(output);assert(state.isFile()&&!state.isSymbolicLink()&&state.nlink===1,'Existing result must be an owned regular file');}catch(error){if(error.code!=='ENOENT')throw error;}
  const result=await verifyPublic({baseUrl:options['--base-url'],expected});
  result.expectedArtifactSha256=digest(raw);result.verifierSha256=digest(readFileSync(fileURLToPath(import.meta.url)));
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({output,passed:result.passed,passedChecks:result.passedChecks,requests:result.requests,newVersionUrls:result.newVersionUrls,oldVersionUrls:result.oldVersionUrls,elapsedMs:result.elapsedMs}));
  if(!result.passed)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error?.message||error));process.exitCode=1;});
