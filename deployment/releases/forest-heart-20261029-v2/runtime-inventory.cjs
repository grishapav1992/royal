const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const result = {};
const canonical = process.argv.includes('--canonical');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function walk(directory, links = false) {
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name), stat = fs.lstatSync(file), relative = path.relative('/app', file);
    if (stat.isSymbolicLink()) {
      if (!links) throw Error('Unexpected runtime symlink');
      result[relative] = hash('symlink\0' + fs.readlinkSync(file));
    } else if (stat.isDirectory()) walk(file, links);
    else if (stat.isFile()) {
      const bytes = fs.readFileSync(file);
      result[relative] = hash(canonical && /\.(?:js|css|html|json)$/.test(file) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes);
    }
    else throw Error('Unexpected runtime file type');
  }
}
for (const directory of canonical ? ['dist'] : ['dist', 'dist-server', 'module-dist']) walk('/app/' + directory);
if (!canonical) {
  walk('/app/node_modules', true);
  for (const name of ['package.json', 'package-lock.json']) result[name] = hash(fs.readFileSync('/app/' + name));
}
console.log(JSON.stringify(result));
