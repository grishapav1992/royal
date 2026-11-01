import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {projectedMediaBytes} from '../scripts/module-source-projection.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('reviewed SVG and JSON retain exact production LF bytes from Windows checkouts',()=>{
 for(const [name,text]of [['flags.svg','<svg>\n</svg>\n'],['manifest.json','{\n"version":1\n}\n']]){
  const expected=Buffer.from(text),checkout=Buffer.from(text.replaceAll('\n','\r\n'));
  assert.deepEqual(projectedMediaBytes(name,checkout,sha(expected)),expected);
 }
});
test('content changes and undeclared text remain rejected after newline normalization',()=>{
 assert.throws(()=>projectedMediaBytes('flags.svg',Buffer.from('<svg>changed</svg>\r\n'),sha(Buffer.from('<svg/>\n'))));
 assert.throws(()=>projectedMediaBytes('manifest.json',Buffer.from('{}\r\n'),undefined));
});
test('binary media stays byte-exact, including CRLF-like sequences',()=>{
 const bytes=Buffer.from([255,13,10,0]);assert.deepEqual(projectedMediaBytes('sprite.png',bytes,sha(bytes)),bytes);
 assert.throws(()=>projectedMediaBytes('sprite.png',bytes,sha(Buffer.from([255,10,0]))));
});
