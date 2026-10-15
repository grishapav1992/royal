import { mkdir, readdir, copyFile, readFile, writeFile, access, unlink } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { permissionArgs } from './codex.mjs';
import { hydratePostgresLinks } from './postgres-links.mjs';
import { DATABASE_HARNESS } from './database-harness.mjs';
import { writeFixture } from './fixtures.mjs';
import { bwrapArgs } from './check-sandbox.mjs';
import { browserCheck, browserTestSelection } from './browser-checks.mjs';

const ROOT_FILES = /^(?:package(?:-lock)?\.json|tsconfig.*\.json|vite\.config\.ts|playwright.*\.ts|index\.html|Dockerfile|README\.md|AGENTS\.md|THIRD_PARTY_NOTICES\.md)$/;
const ROOT_DIRS = new Set(['src','server','public','tests','server-tests','scripts','docs']);
const DENIED = /^(?:\.env(?:\..*)?|\.git|\.codex|\.agents|node_modules|data|secrets|credentials|dist(?:-server)?|artifacts|test-results.*|playwright-report)$/;
const SECRET_FILE = /(?:private.*key|\.pem$|\.key$|auth\.json$|secret)/i;

export function cleanEnv(extra = {}) {
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',HOME:'/tmp/factory-test-home',NODE_ENV:'test',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  if(process.platform==='darwin') env.HOME=process.env.HOME;
  for(const key of ['TMPDIR','TEMP','TMP']) if(process.env[key]) env[key]=process.env[key];
  if(process.env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH=process.env.PLAYWRIGHT_BROWSERS_PATH;
  return {...env,...extra};
}

export async function command(binary,args,{cwd,timeoutMs=300000,signal,maxBytes=2*1024*1024,env=cleanEnv()}={}) {
  if(binary==='git')args=['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args];
  return new Promise((resolveResult,reject)=>{
    if(signal?.aborted){reject(signal.reason || new Error('Command cancelled'));return;}
    const child=spawn(binary,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    const chunks=[];
    let bytes=0,timedOut=false,outputLimited=false,killTimer;
    const kill=name=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,name);else child.kill(name);}catch{}};
    const terminate=()=>{kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),2000);killTimer.unref();};
    const abort=()=>terminate();
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;terminate();},timeoutMs);timer.unref();
    const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
    const collect=chunk=>{bytes+=chunk.length;if(bytes<=maxBytes)chunks.push(chunk);else if(!outputLimited){outputLimited=true;terminate();}};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',error=>{cleanup();reject(error);});
    child.on('close',code=>{cleanup();resolveResult({passed:code===0&&!timedOut&&!outputLimited&&!signal?.aborted,exit_code:code,timed_out:timedOut,output_limited:outputLimited,output:Buffer.concat(chunks).toString('utf8')});});
  });
}

export function sandboxedCommand(binary,args,options){
  const dependencyInstall=options.dependencyInstall===true;
  return command('codex',['sandbox','-P',dependencyInstall?'royal-dependencies':'royal-tester','-C',options.cwd,...permissionArgs('tester',{dependencyInstall}),'--',binary,...args],options);
}

export async function fixedCheckCommand(binary,args,options){
  const isolated=await bwrapArgs(binary,args,options);
  return command('/usr/bin/bwrap',isolated,{...options,env:cleanEnv()});
}

export class Workspaces {
  constructor({source,directory}){this.source=resolve(source);this.directory=resolve(directory);}
  path(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid workspace ID');return join(this.directory,id);}
  async prepare(id,{signal,reinstall=false}={}){
    const path=this.path(id);await mkdir(path,{recursive:true});
    for(const name of ['.git','.agents','.codex','.aws'])await mkdir(join(path,name),{recursive:true});
    await writeFixture(path,'playwright.config.mjs',`import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
export default defineConfig({testDir:'../tests',timeout:45000,workers:1,use:{baseURL:'http://127.0.0.1:5173',channel:'chromium',viewport:{width:1440,height:1000}},webServer:[{command:'npm run dev:web -- --port 5173',cwd,url:'http://127.0.0.1:5173',reuseExistingServer:false},{command:'npm run dev:server',cwd,url:'http://127.0.0.1:2567/healthz',reuseExistingServer:false}]});
`);
    await writeFixture(path,'database-test.mjs',DATABASE_HARNESS);
    try {
      const lock=await readFile(join(path,'package-lock.json'));
      const marker=await readFile(join(path,'.git','factory-ready'),'utf8');
      if(!reinstall&&marker===createHash('sha256').update(lock).digest('hex')){
        await hydratePostgresLinks(path);return path;
      }
    } catch{}
    let initialized=false;
    try{await access(join(path,'.git','HEAD'));initialized=true;}catch{}
    if(!initialized){
      await this.copySource(path);
      await writeFile(join(path,'.gitignore'),'node_modules/\ndist/\ndist-server/\ntest-results*/\nplaywright-report/\ndata/\n.cache/\ncoverage/\n.env*\n.factory/\n');
      for(const args of [['init'],['config','user.name','Royal AI'],['config','user.email','ai@royal.invalid'],['add','.'],['commit','-m','Initial isolated project snapshot']]) {
        const result=await command('git',args,{cwd:path,signal});if(!result.passed)throw new Error(`Workspace Git initialization failed: ${result.output.slice(-300)}`);
      }
    }
    await unlink(join(path,'.git','factory-ready')).catch(error=>{if(error.code!=='ENOENT')throw error;});
    const install=await sandboxedCommand('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:path,timeoutMs:300000,signal,dependencyInstall:true});
    if(!install.passed)throw new Error('Не удалось установить зависимости рабочей копии.');
    await hydratePostgresLinks(path);
    await writeFile(join(path,'.git','factory-ready'),createHash('sha256').update(await readFile(join(path,'package-lock.json'))).digest('hex'));
    return path;
  }
  async copySource(target){
    const files=[];
    const copy=async(from,to)=>{
      for(const item of await readdir(from,{withFileTypes:true})) {
        if(item.name.startsWith('._')||DENIED.test(item.name)||SECRET_FILE.test(item.name)||item.isSymbolicLink())continue;
        const src=join(from,item.name),dst=join(to,item.name);
        if(item.isDirectory()){await mkdir(dst,{recursive:true});await copy(src,dst);}
        else if(item.isFile()) {await copyFile(src,dst);files.push(relative(target,dst));}
      }
    };
    for(const item of await readdir(this.source,{withFileTypes:true})) {
      if(item.isSymbolicLink())continue;
      const src=join(this.source,item.name),dst=join(target,item.name);
      if(item.isDirectory()&&ROOT_DIRS.has(item.name)){await mkdir(dst,{recursive:true});await copy(src,dst);}
      else if(item.isFile()&&ROOT_FILES.test(item.name)){await copyFile(src,dst);files.push(item.name);}
    }
    if(!files.includes('package.json'))throw new Error('Project source missing');
    await writeFile(join(target,'.factory-source.json'),JSON.stringify({created_at:new Date().toISOString(),files}));
  }
  async commit(path){
    const status=await command('git',['status','--porcelain'],{cwd:path});
    if(!status.passed)throw new Error('Cannot inspect workspace');
    const stage=await command('git',['add','-A'],{cwd:path});
    if(!stage.passed)throw new Error('Cannot stage workspace');
    const changes=await command('git',['diff','--cached','--quiet'],{cwd:path});
    if(!changes.passed){const commit=await command('git',['commit','-m','Implement accepted task'],{cwd:path});if(!commit.passed)throw new Error('Cannot commit workspace');}
    return this.head(path);
  }
  async head(path){const result=await command('git',['rev-parse','HEAD'],{cwd:path});if(!result.passed||!/^[a-f0-9]{40}$/.test(result.output.trim()))throw new Error('Invalid candidate commit');return result.output.trim();}
  async exportPatch(path,id,commit,directory){
    this.path(id);
    if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Invalid candidate commit');
    const base=await command('git',['rev-list','--max-parents=0',commit],{cwd:path});
    const baseCommit=base.output.trim();
    if(!base.passed||!/^[a-f0-9]{40}$/.test(baseCommit))throw new Error('Invalid source baseline');
    const diff=await command('git',['diff','--binary',`${baseCommit}..${commit}`],{cwd:path,maxBytes:16*1024*1024});
    if(!diff.passed)throw new Error('Не удалось сохранить файл изменений кандидата.');
    const filename=`${id}-${commit}.patch`;
    await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(join(directory,filename),diff.output,{mode:0o600});
    return {filename,sha256:createHash('sha256').update(diff.output).digest('hex'),bytes:Buffer.byteLength(diff.output),base_commit:baseCommit};
  }
  async checks(path,{signal,onPhase,task}={}){
    const checks=[];
    const postgres=await hydratePostgresLinks(path);
    await writeFixture(path,'database-test.mjs',DATABASE_HARNESS);
    await onPhase?.('build');
    const build=await fixedCheckCommand('npm',['run','build'],{cwd:path,timeoutMs:300000,signal,env:cleanEnv({NODE_ENV:'production',NODE_OPTIONS:'--max-old-space-size=384'})});
    checks.push({name:'Сборка проекта',passed:build.passed,detail:build.output.slice(-12000)});
    if(!build.passed)return checks;
    const testFiles=(await readdir(join(path,'server-tests'))).filter(name=>!name.startsWith('.')&&name.endsWith('.test.ts')).map(name=>`server-tests/${name}`);
    const serverArgs=['.factory/database-test.mjs','--import','tsx','--test','--test-concurrency=1',...testFiles];
    await onPhase?.('server_tests');
    const server=await fixedCheckCommand(postgres.libraryPath?'/usr/bin/env':process.execPath,postgres.libraryPath?[`LD_LIBRARY_PATH=${postgres.libraryPath}`,process.execPath,...serverArgs]:serverArgs,{cwd:path,timeoutMs:600000,signal});
    checks.push({name:'Серверные проверки в отдельной базе',passed:server.passed,detail:server.output.slice(-16000)});
    if(server.passed&&task){
      const available=(await readdir(join(path,'tests'))).filter(name=>/^[A-Za-z0-9][A-Za-z0-9_-]*\.spec\.ts$/.test(name)).map(name=>`tests/${name}`);
      const tests=browserTestSelection(task,available);
      if(tests.length){
        await onPhase?.('browser_tests');
        checks.push(await browserCheck({task,candidate:await this.head(path),tests,signal}));
      }
    }
    return checks;
  }
  async fingerprint(path){
    const result=await command('git',['status','--porcelain','--untracked-files=all'],{cwd:path});
    if(!result.passed||result.output.trim())throw new Error('Рабочая копия содержит неподтвержденные изменения.');
    const tree=await command('git',['rev-parse','HEAD^{tree}'],{cwd:path});
    if(!tree.passed)throw new Error('Не удалось проверить исходники кандидата.');
    return createHash('sha256').update(tree.output).digest('hex');
  }
}
