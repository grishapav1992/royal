import { IndependentGameUI } from '../../src/modules/IndependentGameUI';
import { demoWallet } from '../../src/wallet/WalletClient';
import { expansionClient } from '../../src/wallet/ExpansionClient';
import { language } from '../../src/i18n/index';
import { gameAudio } from '../../src/game/GameAudio';

gameAudio.install();

let module: IndependentGameUI;
const host = document.querySelector<HTMLElement>('#preview')!;
const open = () => { module?.destroy(); module = new IndependentGameUI(host, 'studio-neopolis'); };
const fail = (error: unknown) => { host.replaceChildren(); const message = document.createElement('p'); message.style.cssText = 'padding:24px;color:#e5a6ad'; message.textContent = error instanceof Error ? error.message : String(error); host.append(message); };
async function start() {
  document.querySelector('#review-label')!.textContent = language === 'en' ? 'Local review stand · Separate test database' : 'Локальный стенд · отдельная тестовая база';
  document.querySelector('#reopen')!.setAttribute('aria-label', language === 'en' ? 'Reopen game' : 'Открыть заново');
  let account = (await (await fetch('/api/auth/me')).json()).account;
  if (!account) {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'neopolis-local-' + crypto.randomUUID() + '@example.test', password: 'Neopolis-local-review-42!' }) });
    if (!response.ok) throw Error('Local test account could not be created');
    account = (await response.json()).account;
    const deposit = await fetch('/api/demo-wallet/operations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Royal-Account-Id': account.id }, body: JSON.stringify({ id: crypto.randomUUID(), kind: 'deposit', amount: 10000 }) });
    if (!deposit.ok) throw Error('Local demo deposit failed');
  }
  demoWallet.setAccount(account.id); await demoWallet.refresh();
  expansionClient.setAccount(account.id); await expansionClient.refresh(); open();
  (window as any).neopolisPreview = { open, close: () => module.destroy(), pause: () => module.pause(), resume: () => module.resume(), state: () => module.getState(), account: account.id, client: expansionClient, wallet: demoWallet };
  document.querySelector('#reopen')!.addEventListener('click', open);
}
void start().catch(fail);
