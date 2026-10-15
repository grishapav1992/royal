#!/bin/bash
set +x
set -euo pipefail
royal_np_value=''
trap 'unset royal_np_value' EXIT
case "${1:-api-key}" in
  api-key) royal_np_name='NOWPAYMENTS_API_KEY'; royal_np_label='API Key' ;;
  ipn-secret) royal_np_name='NOWPAYMENTS_IPN_SECRET'; royal_np_label='IPN Secret' ;;
  *) printf '%s\n' 'Нужен api-key или ipn-secret.'; exit 1 ;;
esac
printf '%s\n' 'Подключение NOWPayments к Роялю' 'Ключ вводится скрыто и передается на сервер по защищенному SSH.' 'Включение платежей и перезапуск игры не выполняются.'
printf '\nВставьте %s и нажмите Enter: ' "$royal_np_label"
IFS= read -r -s royal_np_value < /dev/tty
printf '\n'
royal_np_value="${royal_np_value#"${royal_np_value%%[![:space:]]*}"}"
royal_np_value="${royal_np_value%"${royal_np_value##*[![:space:]]}"}"
if [[ ${#royal_np_value} -lt 16 || ${#royal_np_value} -gt 512 || ! "$royal_np_value" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  printf '%s\n' 'Нужен только сам ключ, без названия поля, пробелов и кавычек.'
  exit 1
fi
printf '%s' "$royal_np_value" | ssh -i "$HOME/.ssh/royal_server_ed25519" -o BatchMode=yes -o ConnectTimeout=15 root@45.192.12.242 "python3 /opt/royal-admin/nowpayments-set-secret-v1.py $royal_np_name"
unset royal_np_value
printf '%s\n' 'Готово. Это окно можно закрыть. Сам ключ не отображался и не записывался в историю команд.'
