import './i18n/paymentMethodsEn';
import { requireEntryAccount } from './ui/EntryLogin';
import { chooseEntryMode, type EntryMode } from './ui/EntryModes';
import { t } from './i18n/index';

async function boot() {
  const url = new URL(location.href);
  let mode: EntryMode = 'club';
  if (url.searchParams.get('offline') !== '1') {
    mode = await chooseEntryMode();
    while (!(await requireEntryAccount())) mode = await chooseEntryMode(mode);
    if (url.searchParams.has('mode') && url.searchParams.get('mode') !== mode) {
      url.searchParams.set('mode', mode);
      history.replaceState(history.state, '', url);
    }
  }
  const { startRoyal } = await import('./main');
  await startRoyal(mode);
}
void boot().catch(error => {
  console.error('Royal could not start', error);
  const message = document.createElement('p'); message.setAttribute('role', 'alert');
  message.textContent = t('Не получилось открыть Royal. Обнови страницу и попробуй ещё раз.');
  document.querySelector('#app')!.append(message);
});
