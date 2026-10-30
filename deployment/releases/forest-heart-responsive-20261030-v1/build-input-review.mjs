import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(Buffer.from(bytes).toString().replace(/\r\n/g,'\n')).digest('hex');
export function reviewBuildInputs(before,baseline,prepared,review){
 assert.equal(review.productionCommit,before.sourceCommit);
 for(const name of ['package.json','tsconfig.json']){
  assert.equal(sha(baseline[name]),before.sourceLF[name],'Retained production input differs: '+name);
  assert.equal(sha(baseline[name]),review.files[name].productionSha256);
  assert.equal(sha(prepared[name]),review.files[name].preparedSha256,'Prepared input differs from review: '+name);
 }
 const [oldPackage,newPackage]=[baseline,prepared].map(files=>JSON.parse(files['package.json']));
 const {scripts:oldScripts,...oldIdentity}=oldPackage,{scripts:newScripts,...newIdentity}=newPackage;
 assert.deepEqual(newIdentity,oldIdentity,'Package identity or dependency changed');
 const changed=[...new Set([...Object.keys(oldScripts),...Object.keys(newScripts)])].filter(key=>oldScripts[key]!==newScripts[key]).sort();
 assert.deepEqual(changed,[...review.scriptChanges].sort(),'Unexpected script changes');
 assert(changed.every(key=>/^(test:|preview:)/.test(key)),'Build or runtime script changed');
 const oldConfig=JSON.parse(baseline['tsconfig.json']),newConfig=JSON.parse(prepared['tsconfig.json']);
 assert(!Object.hasOwn(oldConfig.compilerOptions,'resolveJsonModule'));
 assert.equal(newConfig.compilerOptions.resolveJsonModule,true);
 delete newConfig.compilerOptions.resolveJsonModule;
 assert.deepEqual(newConfig,oldConfig,'Compiler or resolver option changed');
 return{productionCommit:review.productionCommit,files:review.files,scriptChanges:changed,productionFilesPreserved:true};
}
