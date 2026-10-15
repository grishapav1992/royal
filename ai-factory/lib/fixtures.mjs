import {constants} from 'node:fs';
import {mkdir,lstat,realpath,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export async function writeFixture(workspace,name,content){
  if(!['playwright.config.mjs','database-test.mjs'].includes(name))throw new Error('Unknown managed fixture');
  const workspaceInfo=await lstat(workspace);
  if(workspaceInfo.isSymbolicLink()||!workspaceInfo.isDirectory())throw new Error('Workspace must be a real directory');
  const root=await realpath(workspace);
  const directory=join(root,'.factory');
  await mkdir(directory,{recursive:true});
  const info=await lstat(directory);
  if(info.isSymbolicLink()||!info.isDirectory()||await realpath(directory)!==resolve(directory))throw new Error('Managed fixture directory must stay inside the workspace');
  const path=join(directory,name);
  const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  try{
    const stat=await file.stat();
    if(!stat.isFile()||stat.nlink!==1)throw new Error('Managed fixtures must be regular files without additional links');
    await file.truncate(0);
    await file.writeFile(content);
  }finally{await file.close();}
}
