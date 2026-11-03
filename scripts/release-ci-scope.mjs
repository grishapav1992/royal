import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function ciScope(paths){
 if(!paths.length)return 'full';
 const note=name=>name==='AGENTS.md'||name==='README.md'||name==='deployment/SERVER.md'||/^docs\/.+\.md$/.test(name)||/^deployment\/releases\/[a-zA-Z0-9_.-]+\/README\.md$/.test(name);
 const record=name=>/^deployment\/releases\/[a-zA-Z0-9_.-]+\/verification\.json$/.test(name);
 if(paths.every(note))return 'docs';
 if(paths.every(name=>note(name)||record(name)))return 'records';
 return 'full';
}
export function ciScopeFromGit(root,base){
 if(!/^[a-f0-9]{40}$/.test(base??'')||/^0+$/.test(base))return 'full';
 const git=args=>execFileSync(process.env.ROYAL_GIT_BINARY||'git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']});
 try{git(['merge-base','--is-ancestor',base,'HEAD']);return ciScope(git(['diff','--name-only','--no-renames','-z',base,'HEAD']).split('\0').filter(Boolean));}
 catch{return 'full';}
}
export function ciResult(profile,scopeResult,applicationResult,recordsResult){
 if(scopeResult!=='success')return false;
 if(profile==='full')return applicationResult==='success';
 if(profile==='records')return recordsResult==='success';
 return profile==='docs'&&applicationResult==='skipped'&&recordsResult==='skipped';
}
export async function qualifiedCiBase(base,repository,token,request=fetch){
 if(!/^[a-f0-9]{40}$/.test(base??'')||!/^[-\w.]+\/[-\w.]+$/.test(repository??'')||!token)return false;
 try{
  const response=await request(`https://api.github.com/repos/${repository}/actions/workflows/game-rtp.yml/runs?status=success&event=push&per_page=100`,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return false;
  const data=await response.json();return Array.isArray(data.workflow_runs)&&data.workflow_runs.some(run=>run.head_sha===base&&run.status==='completed'&&run.conclusion==='success'&&run.event==='push'&&run.head_branch==='main'&&run.path?.split('@')[0]==='.github/workflows/game-rtp.yml');
 }catch{return false;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 if(process.argv[2]==='--result'){
  process.exitCode=ciResult(process.env.RELEASE_PROFILE,process.env.RELEASE_SCOPE_RESULT,process.env.RELEASE_APP_RESULT,process.env.RELEASE_RECORDS_RESULT)?0:1;
 }else{
 const base=process.env.RELEASE_PR_BASE||process.env.RELEASE_PUSH_BEFORE;
 let profile=ciScopeFromGit(process.cwd(),base);
 // A pending code build cannot be bypassed by immediately pushing a release note.
 if(profile!=='full'&&!await qualifiedCiBase(base,process.env.GITHUB_REPOSITORY,process.env.RELEASE_ACTIONS_TOKEN))profile='full';
 console.log('profile='+profile);
 }
}
