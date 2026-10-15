import { CasinoApiProClient,casinoApiProConfig } from '../server/casinoApiPro';

try {
  const config=casinoApiProConfig({...process.env,CASINOAPIPRO_ENABLED:'true'})!;
  const games=await new CasinoApiProClient(config).games();
  console.log(`Тестовый режим SANDBOX подтверждён. Доступно игр: ${games.length}. Валюта: ${config.currency}.`);
  console.log('Далее настрой REST-кошелёк и Test connection в кабинете поставщика по deployment/CASINOAPIPRO.md. Эта команда не проверяет callbacks и не запускает ставки.');
} catch {
  console.error('Проверка не прошла. Проверь тестовые ключи ck_test_/cs_test_, секрет кошелька, PUBLIC_ORIGIN и доступность поставщика. Секреты не выводятся.');
  process.exitCode=1;
}
