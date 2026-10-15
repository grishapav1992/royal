#!/bin/bash
set +x
set -euo pipefail
royal_np_directory="$(cd "$(dirname "$0")" && pwd)"
exec /bin/bash "$royal_np_directory/connect-nowpayments.command" ipn-secret
