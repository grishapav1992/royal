import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { isIP } from 'node:net';

const { permissionArgs } = await import(`data:text/javascript;base64,${adapterBase64}`);
let externalControlIp;
if (process.env.ROYAL_SANDBOX_EGRESS_CONTROL === 'bridge') {
  const control = await new Promise(resolve => {
    const request = http.get('http://example.com/', response => {
      const ip = response.socket.remoteAddress;
      response.resume();
      response.on('end', () => resolve({ passed: response.statusCode >= 200 && response.statusCode < 400 && !!isIP(ip), status: response.statusCode, ip }));
    });
    request.setTimeout(8000, () => request.destroy());
    request.on('error', error => resolve({ passed: false, error: error.code ?? 'request_failed' }));
  });
  console.log(JSON.stringify({ check: 'outer_external_control', url: 'http://example.com/', ...control }));
  if (!control.passed) throw new Error('The external positive control failed; network isolation is unproven.');
  externalControlIp = control.ip;
}
const workspace = '/tmp/royal-workspace';
for (const path of [workspace, ...['.git','.agents','.codex','.aws','.factory'].map(name=>`${workspace}/${name}`), '/home/node/.codex', '/home/node/royal-private']) {
  mkdirSync(path, { recursive: true });
}
writeFileSync(`${workspace}/.git/probe`, 'public test fixture');
writeFileSync(`${workspace}/.factory/probe`, 'trusted controller fixture');
writeFileSync('/home/node/.codex/probe', 'dummy fixture, not a credential');
writeFileSync('/home/node/royal-private/probe', 'dummy fixture, not a secret');

const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node', CODEX_HOME: '/home/node/.codex' };
const localhostProgram = `
const http=require('http');
const server=http.createServer((request,response)=>response.end('sandbox-probe'));
const stop=error=>{server.close(); process.exitCode=error?1:0;};
server.on('error',()=>stop(true));
server.listen(0,'127.0.0.1',()=>{
  const request=http.get({hostname:'127.0.0.1',port:server.address().port,path:'/'},response=>{
    let body=''; response.on('data',chunk=>{body+=chunk;});
    response.on('end',()=>stop(response.statusCode!==200||body!=='sandbox-probe'));
  });
  request.setTimeout(3000,()=>request.destroy()); request.on('error',()=>stop(true));
});`;
const blockedDomainProgram = `
const net=require('net');
const value=process.env.HTTP_PROXY||process.env.http_proxy;
if(!value) process.exit(1);
const proxy=new URL(value);
if(proxy.protocol!=='http:'||!['127.0.0.1','localhost'].includes(proxy.hostname)) process.exit(1);
const socket=net.connect({host:proxy.hostname,port:Number(proxy.port)});
let body='',finished=false;
const finish=status=>{if(finished)return;finished=true;socket.destroy();console.log(JSON.stringify({policy_denied:status===403,status}));process.exitCode=status===403?0:1;};
socket.once('connect',()=>socket.write('GET http://example.com/ HTTP/1.1\\r\\nHost: example.com\\r\\nConnection: close\\r\\n\\r\\n'));
socket.on('data',chunk=>{body+=chunk.toString();if(body.length>4096){finish(null);return;}const match=new RegExp('^HTTP/1[.][01] ([0-9]{3})').exec(body);if(match)finish(Number(match[1]));});
socket.once('error',()=>finish(null));socket.once('end',()=>finish(null));socket.setTimeout(3000,()=>finish(null));`;
const checks = [
  ['runtime_read', 'const fs=require("fs"); fs.openSync("/bin/sh","r");', true],
  ['outside_workspace_read', 'const fs=require("fs"); fs.openSync("/home/node/royal-private/probe","r");', false],
  ['auth_directory_read', 'const fs=require("fs"); fs.openSync("/home/node/.codex/probe","r");', false],
  ['git_metadata_write', `const fs=require("fs"); fs.writeFileSync("${workspace}/.git/probe","modified");`, false],
  ['controller_fixture_write', `const fs=require("fs"); fs.writeFileSync("${workspace}/.factory/probe","modified");`, false],
  ['outside_workspace_write', 'const fs=require("fs"); fs.writeFileSync("/home/node/royal-private/output","modified");', false],
];

let failures = 0;
for (const role of ['analyst', 'developer', 'tester']) {
  const permission = permissionArgs(role, { env });
  const cases = [...checks,
    ['workspace_write', `const fs=require("fs"); fs.writeFileSync("${workspace}/output-${role}","generated");`, role !== 'analyst'],
    ['temporary_write', `const fs=require("fs"); fs.writeFileSync("/tmp/royal-output-${role}","generated");`, true],
    ['localhost_server_and_client', localhostProgram, role !== 'analyst'],
  ];
  if (role !== 'analyst') cases.push(['external_domain_proxy_denial', blockedDomainProgram, true]);
  if (externalControlIp && role !== 'analyst') cases.push(['direct_external_ip_denial', `
const net=require('net');
for(const name of ['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','ALL_PROXY','all_proxy']) delete process.env[name];
const socket=net.connect({host:${JSON.stringify(externalControlIp)},port:80});
socket.on('connect',()=>{socket.destroy();process.exitCode=1;});
socket.on('error',error=>{const denied=['ENETUNREACH','EACCES','EPERM'].includes(error.code);console.log(JSON.stringify({policy_denied:denied,code:error.code}));process.exitCode=denied?0:1;});
socket.setTimeout(3000,()=>{socket.destroy();process.exitCode=1;});`, true]);
  for (const [name, program, shouldPass] of cases) {
    const result = spawnSync('codex', ['sandbox', '-P', `royal-${role}`, '-C', workspace,
      ...permission, '--', 'node', '-e', program], { env, encoding: 'utf8', timeout: 10_000, maxBuffer: 256 * 1024 });
    const completed = Number.isInteger(result.status) && !result.error;
    const requiresProof = ['external_domain_proxy_denial','direct_external_ip_denial'].includes(name);
    let proof;
    try { if (requiresProof) proof = JSON.parse((result.stdout ?? '').trim()); } catch {}
    const passed = completed && (shouldPass ? result.status === 0 : result.status !== 0) && (!requiresProof || proof?.policy_denied === true);
    if (!passed) failures++;
    console.log(JSON.stringify({ role, check: name, passed, expected: shouldPass ? 'allowed' : 'blocked',
      status: result.status, error: result.error?.code ?? null,
      ...(requiresProof ? { proof: (result.stdout ?? '').trim().slice(0,256) } : {}),
      ...(shouldPass && !passed ? { diagnostic: (result.stderr ?? '').slice(0,1024) } : {}) }));
  }
}
if (failures) process.exitCode = 1;
