#!/bin/bash
set -euo pipefail
umask 077
royal_sandbox_script_dir="$(cd "$(dirname "$0")" && pwd)"
royal_sandbox_git=git
if [ -x /Library/Developer/CommandLineTools/usr/bin/git ]; then
  royal_sandbox_git=/Library/Developer/CommandLineTools/usr/bin/git
fi
royal_sandbox_common="$("$royal_sandbox_git" -C "$royal_sandbox_script_dir/.." rev-parse --path-format=absolute --git-common-dir)"
royal_sandbox_root="$(dirname "$royal_sandbox_common")"
royal_sandbox_node="$(command -v node || true)"
if [ -z "$royal_sandbox_node" ] && [ -x /opt/homebrew/bin/node ]; then
  royal_sandbox_node=/opt/homebrew/bin/node
fi
if [ -z "$royal_sandbox_node" ]; then
  printf 'Не найден Node.js. Сообщи об этой ошибке в чат, ключи не отправляй.\n' >&2
  exit 1
fi
royal_sandbox_writer="$royal_sandbox_script_dir/../deployment/write-nowpayments-sandbox-config.mjs"
printf 'Ключи только из account-sandbox.nowpayments.io. Боевые ключи не вводи.\n'
printf 'Символы при вставке скрыты. Сначала скопируй верхний Your API key.\n'
while true; do
  if ! IFS= read -r -s -p 'Sandbox API Key: ' royal_sandbox_api; then
    printf '\nВвод отменён. Файл с ключами не создан.\n' >&2
    exit 1
  fi
  printf '\n'
  if printf '%s' "$royal_sandbox_api" | "$royal_sandbox_node" "$royal_sandbox_writer" --validate api; then break; fi
done
printf 'Теперь скопируй IPN Secret из Instant payment notifications.\n'
while true; do
  if ! IFS= read -r -s -p 'Sandbox IPN Secret: ' royal_sandbox_ipn; then
    printf '\nВвод отменён. Файл с ключами не создан.\n' >&2
    unset royal_sandbox_api
    exit 1
  fi
  printf '\n'
  if printf '%s' "$royal_sandbox_ipn" | "$royal_sandbox_node" "$royal_sandbox_writer" --validate ipn; then break; fi
done
printf '%s\n%s\n' "$royal_sandbox_api" "$royal_sandbox_ipn" | "$royal_sandbox_node" "$royal_sandbox_writer" "$royal_sandbox_root"
unset royal_sandbox_api royal_sandbox_ipn
printf 'Ключи сохранены локально. Реальные платежи и вывод не включались.\n'
