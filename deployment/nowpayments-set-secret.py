"""Store one NOWPayments credential without printing it or enabling payments."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ALLOWED = {"NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"}
FLAGS = ("NOWPAYMENTS_ENABLED", "NOWPAYMENTS_WITHDRAWALS_ENABLED", "NOWPAYMENTS_GAMES_ENABLED")

def updated_config(original, name, value):
    if name not in ALLOWED or not re.fullmatch(r"[A-Za-z0-9._:-]{16,512}", value):
        raise ValueError("Invalid credential")
    for flag in FLAGS:
        for setting in re.findall(r"(?m)^\s*(?:export\s+)?" + flag + r"\s*=([^\r\n]*)", original):
            if setting.split("#", 1)[0].strip().strip("\"'") not in ("", "false"):
                raise ValueError("Payments must remain disabled")
    pattern = re.compile(r"^[ \t]*(?:export[ \t]+)?" + name + r"(?:_FILE)?[ \t]*=")
    kept = "".join(line for line in original.splitlines(keepends=True) if not pattern.match(line))
    return kept.rstrip("\r\n") + "\n" + name + "=" + value + "\n"

def save_secret(path, backup_dir, name, value):
    path, backup_dir = Path(path), Path(backup_dir)
    lock = os.open(path.with_name(".nowpayments-config.lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    temporary = None
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        source = path.lstat()
        if not stat.S_ISREG(source.st_mode) or source.st_size > 1048576:
            raise ValueError("Invalid settings file")
        original = path.read_bytes()
        replacement = updated_config(original.decode("utf8"), name, value).encode("utf8")
        backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory = backup_dir.lstat()
        if not stat.S_ISDIR(directory.st_mode) or directory.st_mode & 0o077 or directory.st_uid != os.geteuid():
            raise ValueError("Invalid private backup directory")
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_fd, backup = tempfile.mkstemp(prefix="nowpayments-" + stamp + "-", suffix=".env", dir=backup_dir)
        with os.fdopen(backup_fd, "wb") as file:
            file.write(original); file.flush(); os.fsync(file.fileno())
        fd, temporary = tempfile.mkstemp(prefix=".nowpayments-env-", dir=path.parent)
        with os.fdopen(fd, "wb") as file:
            file.write(replacement); file.flush(); os.fsync(file.fileno())
            os.fchown(file.fileno(), source.st_uid, source.st_gid)
        if hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(original).digest() or path.lstat().st_ino != source.st_ino:
            raise ValueError("Settings changed concurrently")
        os.replace(temporary, path); temporary = None
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
    finally:
        if temporary is not None: os.unlink(temporary)
        os.close(lock)

def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ALLOWED:
        raise ValueError("Invalid invocation")
    payment_path = Path("/opt/royal-payment-secrets/provider.env")
    container = "royal-payments-1" if payment_path.is_file() else "royal-game-1"
    inspection = subprocess.run(["docker", "inspect", container], capture_output=True, text=True, check=True)
    environment = dict(entry.split("=", 1) for entry in json.loads(inspection.stdout)[0]["Config"]["Env"])
    if any(environment.get(flag, "false") != "false" for flag in FLAGS):
        raise ValueError("Running gateway must remain disabled")
    value = sys.stdin.buffer.read(4097).decode("ascii")
    save_secret(payment_path if payment_path.is_file() else "/opt/royal/.env", "/opt/royal-private-config-backups", sys.argv[1], value)
    print("Ключ сохранен на сервере. Платежи остаются отключенными.")

if __name__ == "__main__":
    try: main()
    except Exception:
        print("Ключ не сохранен. Проверь ввод и состояние настройки шлюза.", file=sys.stderr)
        sys.exit(1)
