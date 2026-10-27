const assert = require('node:assert/strict'), http = require('node:http'), zlib = require('node:zlib');
const express = require('express');
const app = express(); let sendTrailing;
app.post('/parser', express.json(), (req, res) => {
  setImmediate(sendTrailing);
  const finish = () => res.json(req.body);
  if (req.complete) finish(); else req.once('end', finish);
});
app.post('/restricted', express.json({inflate: false}), (_req, res) => res.json({ok: true}));
app.use((error, _req, res, _next) => res.status(error.status || 500).end());
const server = app.listen(0, '127.0.0.1', async () => {
  try {
    const port = server.address().port, first = Buffer.concat([zlib.gzipSync(Buffer.from('{"ok":true}')), Buffer.from([0])]);
    const trailing = Buffer.alloc(1024, 255);
    const status = await new Promise((resolve, reject) => {
      const req = http.request({host: '127.0.0.1', port, path: '/parser', method: 'POST', agent: false,
        headers: {'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': first.length + trailing.length}}, res => {
        res.resume(); res.once('end', () => resolve(res.statusCode));
      });
      sendTrailing = () => req.end(trailing); req.once('error', reject); req.write(first);
    });
    assert.equal(status, 200);
    const response = await fetch('http://127.0.0.1:' + port + '/restricted', {method: 'POST',
      headers: {'Content-Type': 'application/json', 'Content-Encoding': 'gzip'}, body: zlib.gzipSync(Buffer.from('{}'))});
    assert.equal(response.status, 415); await response.arrayBuffer();
    assert.equal(require('body-parser/package.json').version, '2.4.0');
    assert.equal(require('qs/package.json').version, '6.16.1');
    console.log(JSON.stringify({passed: true, node: process.version, delayedGzip: status, compressedApplicationBody: response.status}));
    server.closeAllConnections(); server.close();
  } catch (error) {console.error(error.message); process.exit(1);}
});
setTimeout(() => {console.error('Runtime probe timed out'); process.exit(1);}, 10000).unref();
