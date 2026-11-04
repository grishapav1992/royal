import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyGithub} from '../../../scripts/release.mjs';
const [installerCommit,payloadPath]=process.argv.slice(2);
assert(/^[a-f0-9]{40}$/.test(installerCommit)&&payloadPath);
const receipt=await verifyGithub(process.cwd()),payload=path.resolve(payloadPath);
const op=JSON.parse(fs.readFileSync(payload+'/operator.json'));
const release=JSON.parse(fs.readFileSync('module-build/release-manifest.json'));
assert.equal(op.sourceCommit,receipt.sourceCommit);assert.equal(op.sourceCommit,release.sourceCommit);
execFileSync('git',['merge-base','--is-ancestor',installerCommit,'origin/main']);
const sha=b=>createHash('sha256').update(b).digest('hex'),files={};
for(const name of ['publish.py','bind-current.py']){
 const source='deployment/releases/flag-collision-audio-20261104-v1/'+name;
 const bytes=execFileSync('git',['show',installerCommit+':'+source]);
 files[source]=sha(bytes);fs.writeFileSync(payload+'/'+name,bytes);
}
const evidence={sourceCommit:installerCommit,applicationSourceCommit:op.sourceCommit,includedInMain:true,remoteMain:receipt.remoteMain,files};
const bytes=Buffer.from(JSON.stringify(evidence,null,2)+'\n');fs.writeFileSync(payload+'/installer-github.json',bytes);
const github=fs.readFileSync('module-build/release-github.json');fs.writeFileSync(payload+'/release-github.json',github);
op.installerSourceCommit=installerCommit;op.installerReceiptSha256=sha(bytes);
op.wrapperSha256=files['deployment/releases/flag-collision-audio-20261104-v1/publish.py'];op.receiptSha256=sha(github);
fs.writeFileSync(payload+'/operator.json',JSON.stringify(op,null,2)+'\n');
console.log(JSON.stringify({sourceCommit:op.sourceCommit,installerSourceCommit:installerCommit,applicationRebuilt:false}));
