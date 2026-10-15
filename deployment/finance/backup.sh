#!/bin/sh
set -eu
finance_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$finance_script_dir/operations.py" backup
