import './i18n/paymentMethodsEn';
import { requireEntryAccount } from './ui/EntryLogin';
import { chooseEntryMode } from './ui/EntryModes';
import { t } from './i18n/index';

async function boot() {
  if (new URL(location.href).searchParams.get('offline') !== '1') await requireEntryAccount();
  const mode = await chooseEntryMode();
  const { startRoyal } = await import('./main');
  await startRoyal(mode);
}
void boot().catch(error => {
  console.error('Royal could not start', error);
  const message = document.createElement('p'); message.setAttribute('role', 'alert');
  message.textContent = t('Не получилось открыть Royal. Обнови страницу и попробуй ещё раз.');
  document.querySelector('#app')!.append(message);
});
