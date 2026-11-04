import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {readHostProjection} from '../../../scripts/build-host-projection.mjs';
const folder='deployment/releases/manual-stakes-20261104-v1',before=JSON.parse(fs.readFileSync(process.argv[2]));
const scope=JSON.parse(fs.readFileSync(folder+'/scope.json')),registry=JSON.parse(fs.readFileSync('scripts/game-math/rtp-policy.json'));
const reader=await readHostProjection(process.cwd(),folder+'/host-projection.json',{strictOrigins:true});
assert.equal(reader.metadata.productionCommit,before.sourceCommit);
assert.equal(reader.metadata.files['src/shared/arcadeCatalog.ts'].sha256,before.sourceLF['src/shared/arcadeCatalog.ts']);
const compiled=await build({entryPoints:['src/shared/arcadeCatalog.ts'],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'verified-catalogue',setup(b){b.onLoad({filter:/\.(?:ts|json)$/},args=>({contents:reader.read(path.relative(process.cwd(),args.path).replaceAll('\\','/')),loader:args.path.endsWith('.json')?'json':'ts',resolveDir:path.dirname(args.path)}));}}]});
const {ROYAL_PLATFORM_GAMES}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
assert.equal(ROYAL_PLATFORM_GAMES.length,20);scope.activeGames=[...ROYAL_PLATFORM_GAMES];
assert.deepEqual([...scope.activeGames].sort(),Object.keys(registry.stakePolicies).sort());
const evidence=new Set(['scripts/game-math/rtp-policy.json']);
for(const p of [...Object.values(registry.profiles),...Object.values(registry.stakePolicies),...Object.values(registry.versionProfiles??{}).flatMap(Object.values)]){
  for(const file of [p.proof,p.qualificationSource,...p.sources])if(/^(?:scripts\/game-math\/|docs\/game-math\/)/.test(file))evidence.add(file);
}
for(const name of execFileSync('git',['diff','--name-only','b730f386','HEAD'],{encoding:'utf8'}).trim().split('\n'))if(name.startsWith('scripts/game-math/'))evidence.add(name);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
scope.evidenceSources={};
for(const file of [...evidence].sort()){
  assert(!path.isAbsolute(file)&&!file.split('/').some(p=>p==='..'||p.startsWith('.env')));
  const bytes=fs.readFileSync(file),hash=digest(bytes);
  if(before.source[file]!==hash&&!scope.expectedSources[file])scope.evidenceSources[file]=hash;
}
fs.writeFileSync(folder+'/scope.json',JSON.stringify(scope,null,2)+'\n');
console.log(JSON.stringify({catalogue:scope.activeGames.length,compiledChanges:Object.keys(scope.expectedSources).length,evidenceChanges:Object.keys(scope.evidenceSources).length}));
