import { english } from './en';

export const paymentMethodsEnglish: Record<string, string> = {
  'виртуальных USDT': 'virtual USDT',
  'NOWPayments · Боевой': 'NOWPayments · Live',
  'Боевой баланс': 'Live balance',
  'Реальные средства. Этот баланс хранится отдельно от тестового баланса клуба. Ставки на реальные средства пока недоступны.': 'Real funds. This balance is separate from the club test balance. Real-money wagers are not available yet.',
  'Общий тестовый баланс для игр, ателье и поединков. Пополнение через NOWPayments Sandbox, без перевода реальных денег.': 'One test balance for games, the atelier and duels. Top up through NOWPayments Sandbox without sending real funds.',
  'NOWPayments Sandbox пока не подключён.': 'NOWPayments Sandbox is not connected yet.',
  'Боевой баланс NOWPayments хранится отдельно. Тестовые средства нельзя вывести.': 'The live NOWPayments balance is separate. Test funds cannot be withdrawn.',
  'Открыть тестовый баланс NOWPayments Sandbox': 'Open NOWPayments Sandbox test balance',
  'Тестовое пополнение общего баланса для игр Royal, ателье и поединков. Реальные деньги не используются, вывод недоступен.': 'Test top-ups for Royal games, the atelier and duels. No real funds are used and withdrawals are unavailable.',
  'Сумма тестового пополнения': 'Test top-up amount',
  'Сценарий платежа': 'Payment scenario',
  'Успешный платёж': 'Successful payment',
  'Частичная оплата': 'Partial payment',
  'Неудачный платёж': 'Failed payment',
  'Создать тестовый платёж': 'Create test payment',
  'Проверить сохранённое пополнение': 'Check saved top-up',
  'Проверить тестовые платежи': 'Check test payments',
  'NOWPayments сам воспроизводит выбранный сценарий. После подтверждения средства поступят на виртуальный игровой баланс. Не отправляй криптовалюту на тестовые адреса.': 'NOWPayments simulates the selected scenario. Confirmed funds reach the virtual game balance. Do not send cryptocurrency to test addresses.',
  'Не удалось восстановить тестовое пополнение. Проверь историю перед новой попыткой.': 'Could not restore the test top-up. Check the history before trying again.',
  'Аккаунт изменился. Проверь баланс после входа.': 'The account changed. Check the balance after signing in.',
  'Sandbox не подтвердил ответ.': 'Sandbox did not confirm the response.',
  'Проверь сумму и сценарий тестового платежа.': 'Check the test payment amount and scenario.',
  'Тестовый платёж создан. Ожидаем подтверждение NOWPayments.': 'Test payment created. Waiting for NOWPayments confirmation.',
  'Создаётся': 'Creating',
  'Подтверждается': 'Confirming',
  'Зачисляется': 'Crediting',
  'Оплачен частично': 'Partially paid',
  'Ожидает проверки': 'Awaiting review',
  'Ожидает места на игровом балансе': 'Waiting for room on the game balance',
  'Зачислено': 'Credited',
  'Этот способ оплаты удалён. Используй NOWPayments или NOWPayments Sandbox.': 'This payment method was removed. Use NOWPayments or NOWPayments Sandbox.',
};

Object.assign(paymentMethodsEnglish, {
  "Денежный баланс": "Cash balance",
  "Оплати Stars в боте. Подтверждённый платёж пополнит денежный баланс в USDT.": "Pay with Stars in the bot. Confirmed payments credit your cash balance in USDT.",
  "Количество Stars": "Number of Stars",
  "Принимаю": "I accept the",
  "условия оплаты": "payment terms",
  "Создать счёт Stars": "Create Stars invoice",
  "Оплатить в Telegram": "Pay in Telegram",
  "Проверить сохранённый платёж Stars": "Check saved Stars payment",
  "Платёж Stars не подтверждён.": "Stars payment is not confirmed.",
  "Счёт создан. Открой ссылку «Оплатить в Telegram» ниже.": "Invoice created. Open the Pay in Telegram link below.",
  "Возврат Stars, требуется сверка": "Stars refunded, review required",
  "{0} Stars: {1} USDT на баланс": "{0} Stars: {1} USDT to your balance"
});
Object.assign(paymentMethodsEnglish, {
  "Telegram не подтвердил операцию. Проверь тот же платёж позже.": "Telegram did not confirm the operation. Check the same payment later.",
  "Укажи от 100 до 10 000 Stars и прими условия оплаты.": "Choose 100 to 10,000 Stars and accept the payment terms.",
  "Нельзя изменить сохранённый платёж Stars.": "A saved Stars payment cannot be changed.",
  "Оплата Telegram Stars пока не подключена.": "Telegram Stars payments are not connected yet.",
  "Подожди минуту перед новым платежом Stars.": "Wait a minute before creating another Stars payment.",
  "Вывод приостановлен: требуется сверка возврата Stars. Обратись в поддержку.": "Withdrawals are paused while a Stars refund is reviewed. Contact support.",
  "Платёж Stars уже использован.": "This Stars payment has already been used."
});
Object.assign(paymentMethodsEnglish, { 'Баланс хранится в USDT.': 'Your balance is held in USDT.' });
Object.assign(english, paymentMethodsEnglish);
