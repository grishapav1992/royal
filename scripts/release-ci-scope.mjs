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
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 if(process.argv[2]==='--result'){
  process.exitCode=ciResult(process.env.RELEASE_PROFILE,process.env.RELEASE_SCOPE_RESULT,process.env.RELEASE_APP_RESULT,process.env.RELEASE_RECORDS_RESULT)?0:1;
 }else{
 const base=process.env.RELEASE_PR_BASE||process.env.RELEASE_PUSH_BEFORE;
 console.log('profile='+ciScopeFromGit(process.cwd(),base));
 }
}
