#!/bin/sh
set -eu
umask 077
test "$(id -u)" = 0
test -f /opt/royal-finance/compose.finance.yaml
mkdir -p /opt/royal-finance-backups /opt/royal-finance-state
chmod 700 /opt/royal-finance-backups /opt/royal-finance-state
for finance_operation in backup restore monitor; do
  install -m 644 "deployment/finance/systemd/royal-finance-$finance_operation.service" /etc/systemd/system/
  install -m 644 "deployment/finance/systemd/royal-finance-$finance_operation.timer" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable --now royal-finance-backup.timer royal-finance-restore.timer royal-finance-monitor.timer
