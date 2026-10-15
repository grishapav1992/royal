import { mkdir, mkdtemp, writeFile, readFile, symlink, rmdir, unlink, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import net from 'node:net';
import { fixedCheckCommand } from '/app/lib/workspaces.mjs';
const { bwrapArgs } = await import(`data:text/javascript;base64,${moduleBase64}`);
const cwd = '/workspaces/00000000-0000-4000-8000-000000000001';
for(const name of ['.git','.factory','.codex','.agents','.aws']) await mkdir(`${cwd}/${name}`,{recursive:true});
await mkdir('/tmp/royal-outer-auth',{recursive:true});
await writeFile('/tmp/royal-outer-auth/probe','Dummy fixture, not a credential.');
const control=await new Promise(resolve=>{
  const request=http.get('http://example.com/',response=>{
    const ip=response.socket.remoteAddress;response.resume();
    response.on('end',()=>resolve({status:response.statusCode,ip}));
  });
  request.setTimeout(8000,()=>request.destroy());request.on('error',error=>resolve({error:error.code}));
});
console.log(JSON.stringify({check:'outer_external_control',...control}));
if(control.status!==200||!net.isIP(control.ip||''))throw new Error('The outer external positive control failed.');
const sibling=await mkdtemp('/workspaces/royal-fixed-sibling-probe-');
await writeFile(sibling+'/probe','Dummy sibling fixture.');
async function diagnostic() {
  const fs = await import('node:fs/promises');
  const net = await import('node:net');
  const http = await import('node:http');
  let failed=false;
  function record(check,passed,detail){console.log(JSON.stringify({check,passed,detail}));if(!passed)failed=true;}
  for(const prefix of ['nile-play-api-','nile-deposit-api-']) {
    const directory=await fs.mkdtemp('/tmp/'+prefix);
    const path=directory+'/play.sock';
    const server=net.createServer(socket=>socket.end('public-dummy-fixture'));
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
    const response=await new Promise((resolve,reject)=>{
      let body='';const socket=net.connect(path);socket.on('data',chunk=>body+=chunk);
      socket.once('end',()=>resolve(body));socket.once('error',reject);
      socket.setTimeout(3000,()=>socket.destroy(new Error('Unix control timed out.')));
    });
    await new Promise(resolve=>server.close(resolve));
    record(prefix+'unix_bind_connect',response==='public-dummy-fixture');
  }
  const server=http.createServer((request,response)=>response.end('isolated-http'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const body=await new Promise((resolve,reject)=>{
    const request=http.get(`http://127.0.0.1:${server.address().port}/`,response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve(body));});
    request.setTimeout(3000,()=>request.destroy());request.once('error',reject);
  });
  await new Promise(resolve=>server.close(resolve));record('isolated_loopback_http',body==='isolated-http');
  for(const path of ['/tmp/royal-outer-auth/probe',process.argv[2]+'/probe','/app/lib/codex.mjs','/run/docker.sock','/home/node/.codex','/data','/project']) {
    let code='ALLOWED';try{await fs.lstat(path);}catch(error){code=error.code;}
    record('outside_boundary:'+path,['ENOENT','EACCES','EPERM'].includes(code),code);
  }
  for(const name of ['.git','.factory','.codex','.agents','.aws']) {
    let code='ALLOWED';try{await fs.writeFile(process.cwd()+'/'+name+'/fixed-checks-write-probe','fixture');}catch(error){code=error.code;}
    record('readonly_overlay:'+name,['EROFS','EACCES','EPERM'].includes(code),code);
  }
  const output=process.cwd()+'/node_modules/.royal-fixed-checks-write-probe';
  await fs.writeFile(output,'fixture');await fs.unlink(output);record('workspace_write',true);
  const code=await new Promise(resolve=>{
    const socket=net.connect({host:process.argv[1],port:80});
    socket.once('connect',()=>{socket.destroy();resolve('ALLOWED');});
    socket.once('error',error=>resolve(error.code));socket.setTimeout(3000,()=>{socket.destroy();resolve('TIMEOUT');});
  });
  record('direct_external_ip_denial',['ENETUNREACH','EACCES','EPERM'].includes(code),code);
  let procCode='ALLOWED';try{await fs.readFile('/proc/self/status');}catch(error){procCode=error.code;}
  record('host_proc_hidden',procCode==='ENOENT',procCode);
  record('clean_inner_environment',process.env.OPENAI_API_KEY===undefined&&process.env.CODEX_HOME===undefined&&process.env.LD_LIBRARY_PATH===undefined);
  process.exitCode=failed?1:0;
}
const program='('+diagnostic.toString()+')().catch(error=>{console.error(JSON.stringify({error:error.code||String(error)}));process.exitCode=1;});';
const args=await bwrapArgs('/usr/local/bin/node',['--input-type=module','-e',program,control.ip,sibling],{cwd,env:{PLAYWRIGHT_BROWSERS_PATH:'/opt/pw-browsers'}});
const result=spawnSync('bwrap',args,{cwd,env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:30000,maxBuffer:256*1024});
process.stdout.write(result.stdout||'');process.stderr.write((result.stderr||'').slice(-12000));
await rm(sibling,{recursive:true,force:true});
console.log(JSON.stringify({check:'fixed_bwrap_controls',passed:result.status===0&&!result.error,status:result.status,error:result.error?.code||null}));
let passed=result.status===0&&!result.error;
const guardWorkspace='/workspaces/'+randomUUID();
await mkdir(guardWorkspace);
const directories=['.git','.factory','.codex','.agents','.aws'];
let rejected=0;
try {
  for(const name of directories)await mkdir(guardWorkspace+'/'+name);
  for(const name of directories) {
    await rmdir(guardWorkspace+'/'+name);
    await symlink('/tmp/royal-outer-auth',guardWorkspace+'/'+name);
    try { await bwrapArgs('/bin/true',[],{cwd:guardWorkspace}); }
    catch(error) { if(error.message.includes('canonical directories'))rejected++; }
    await unlink(guardWorkspace+'/'+name);
    await mkdir(guardWorkspace+'/'+name);
  }
} finally { await rm(guardWorkspace,{recursive:true,force:true}); }
const guardPassed=rejected===directories.length;
console.log(JSON.stringify({check:'canonical_metadata_symlink_rejection',passed:guardPassed,rejected,directories:directories.length}));
passed=passed&&guardPassed;
const counter=cwd+'/node_modules/.royal-fixed-cancel-'+randomUUID();
const childProgram='const fs=require("fs");setInterval(()=>fs.appendFileSync(process.argv[1],"x"),50);';
const parentProgram='const {spawn}=require("child_process");spawn("node",["-e",process.argv[1],process.argv[2]],{detached:true,stdio:"ignore"});setInterval(()=>{},1000);';
try {
  const timeout=await fixedCheckCommand('/usr/local/bin/node',['-e',parentProgram,childProgram,counter],{cwd,timeoutMs:1200,maxBytes:4096});
  const before=(await readFile(counter)).length;
  await delay(500);
  const after=(await readFile(counter)).length;
  const timeoutPassed=timeout.timed_out===true&&timeout.passed===false&&before>0&&after===before;
  console.log(JSON.stringify({check:'timeout_kills_detached_inner_child',passed:timeoutPassed,timed_out:timeout.timed_out,before,after,exit_code:timeout.exit_code}));
  passed=passed&&timeoutPassed;
} finally { await unlink(counter).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
process.exitCode=passed?0:1;
