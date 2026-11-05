import './i18n/paymentMethodsEn';
import { chooseEntryMode } from './ui/EntryModes';

async function boot() {
  const mode = await chooseEntryMode();
  const { startRoyal } = await import('./main');
  await startRoyal(mode);
}
void boot().catch(error => {
  console.error('Royal could not start', error);
  const message = document.createElement('p'); message.setAttribute('role', 'alert');
  message.textContent = 'Не получилось открыть Royal. Обнови страницу и попробуй ещё раз.';
  document.querySelector('#app')!.append(message);
});
