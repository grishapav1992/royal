import assert from 'node:assert/strict';
import sharp from 'sharp';
import fs from 'node:fs';
assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.PGDATABASE,'royal_test');
assert.equal(process.env.CODEX_SALE_API_KEY,'skin-release-fixture');
const cells=Array.from({length:16},(_,i)=>`<g transform="translate(${i%4*256},${Math.floor(i/4)*384})"><circle cx="128" cy="105" r="65" fill="#f2c59a"/><rect x="80" y="170" width="96" height="150" fill="#bb4433"/><path d="M90 320V350H115V320M142 320V350H167V320" fill="#334466"/></g>`).join('');
const png=await sharp(Buffer.from(`<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`)).png().toBuffer();
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.hostname!=='codex.sale')return original(input,init);
 if(url.pathname!=='/v1/images/generations')return Response.json({error:'Isolated caption fixture unavailable'},{status:503});
 assert.equal(new Headers(init.headers).get('Authorization'),'Bearer skin-release-fixture');
 const value=JSON.parse(init.body);assert.equal(value.n,1);assert.equal(value.size,'1024x1536');assert.equal(value.background,'transparent');
 fs.appendFileSync('artifacts/work/skin-offers-release-20261105/provider-calls.ndjson',JSON.stringify({n:value.n,size:value.size,externalRequest:false})+'\n');
 return Response.json({data:[{b64_json:png.toString('base64')}]});
};
