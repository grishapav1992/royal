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
printf 'Ключи только из account-sandbox.nowpayments.io. Боевые ключи не вводи.\n'
IFS= read -r -s -p 'Sandbox API Key: ' royal_sandbox_api
printf '\n'
IFS= read -r -s -p 'Sandbox IPN Secret: ' royal_sandbox_ipn
printf '\n'
printf '%s\n%s\n' "$royal_sandbox_api" "$royal_sandbox_ipn" | node "$royal_sandbox_script_dir/../deployment/write-nowpayments-sandbox-config.mjs" "$royal_sandbox_root"
unset royal_sandbox_api royal_sandbox_ipn
printf 'Ключи сохранены локально. Реальные платежи и вывод не включались.\n'
