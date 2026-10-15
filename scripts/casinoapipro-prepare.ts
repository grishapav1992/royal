import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';

// This creates only our callback secret. The provider issues its own test credentials.
const path = '.env';
let contents = existsSync(path) ? readFileSync(path,'utf8') : '';
const fields = {
  CASINOAPIPRO_ENABLED:'false', CASINOAPIPRO_API_KEY:'', CASINOAPIPRO_API_SECRET:'',
  CASINOAPIPRO_CURRENCY:'USD', CASINOAPIPRO_WALLET_SECRET:randomBytes(32).toString('hex'),
};
for (const [name,value] of Object.entries(fields)) {
  const pattern = new RegExp(`^${name}=(.*)$`,'m'), match = contents.match(pattern);
  if (!match) contents += `${contents && !contents.endsWith('\n') ? '\n' : ''}${name}=${value}\n`;
  else if (name==='CASINOAPIPRO_WALLET_SECRET' && /^(?:\s*|""|'')$/.test(match[1])) contents=contents.replace(pattern,`${name}=${value}`);
}
writeFileSync(path,contents,{mode:0o600});chmodSync(path,0o600);
console.log('Поля Casino Api Pro подготовлены в локальном .env. Секрет кошелька сохранён в файл и не выводится. Добавь выданные поставщиком тестовые ключи и запусти npm run casinoapipro:check.');
