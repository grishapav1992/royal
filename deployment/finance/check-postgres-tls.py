#!/usr/bin/env python3
"""Real PostgreSQL TLS checks using temporary credentials, network and database."""
import json
import os
from pathlib import Path
import secrets
import tempfile
import time
import uuid

from operations import OpsError, db_container, record, run

os.umask(0o077)
suffix = uuid.uuid4().hex[:12]
network, container = "royal-finance-tls-" + suffix, "royal-finance-tls-db-" + suffix
try:
    with tempfile.TemporaryDirectory(prefix="royal-finance-tls-") as temporary:
        folder = Path(temporary)
        cert, key = folder / "server.crt", folder / "server.key"
        settings = folder / "openssl.cnf"
        settings.write_text("[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n"
                            "[dn]\nCN=finance-tls-test\n[extensions]\nsubjectAltName=DNS:finance-tls-test\n")
        run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
             "-config", str(settings), "-keyout", str(key), "-out", str(cert)], "test_certificate")
        os.chown(key, 0, 999)
        key.chmod(0o440)
        cert.chmod(0o444)
        password = secrets.token_hex(32) + "\n"
        server_password, client_password = folder / "server-password", folder / "client-password"
        for target, group in ((server_password, 999), (client_password, 1000)):
            target.write_text(password)
            os.chown(target, 0, group)
            target.chmod(0o440)
        image = run(["docker", "inspect", db_container(), "--format", "{{.Image}}"], "tls_database_image").decode().strip()
        run(["docker", "network", "create", "--internal", network], "tls_network")
        try:
            run(["docker", "run", "--detach", "--rm", "--name", container,
                 "--label", "royal.finance.tls-test=1", "--network", network,
                 "--network-alias", "finance-tls-test", "--network-alias", "wrong-finance-db",
                 "--user", "postgres", "--read-only", "--memory", "384m", "--cpus", "0.5",
                 "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                 "--tmpfs", "/var/lib/postgresql/data:uid=999,gid=999,mode=0700,size=256m",
                 "--tmpfs", "/var/run/postgresql:uid=999,gid=999,mode=0775,size=16m", "--tmpfs", "/tmp:size=32m",
                 "--mount", "type=bind,src=" + str(cert) + ",dst=/run/test/server.crt,readonly",
                 "--mount", "type=bind,src=" + str(key) + ",dst=/run/test/server.key,readonly",
                 "--mount", "type=bind,src=" + str(server_password) + ",dst=/run/test/password,readonly",
                 "-e", "POSTGRES_USER=finance_tls_test", "-e", "POSTGRES_DB=tls_only",
                 "-e", "POSTGRES_PASSWORD_FILE=/run/test/password",
                 "-e", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256", image,
                 "postgres", "-c", "ssl=on", "-c", "ssl_cert_file=/run/test/server.crt",
                 "-c", "ssl_key_file=/run/test/server.key"], "tls_database")
            deadline = time.monotonic() + 70
            while True:
                try:
                    run(["docker", "exec", container, "pg_isready", "-U", "finance_tls_test", "-d", "tls_only"], "tls_ready")
                    break
                except OpsError:
                    if time.monotonic() > deadline:
                        raise OpsError("tls_database_start_timeout")
                    time.sleep(1)
            output = run(["docker", "run", "--rm", "--network", network, "--user", "node",
                          "--read-only", "--tmpfs", "/tmp:size=16m", "--memory", "128m", "--cpus", "0.25",
                          "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                          "--mount", "type=bind,src=" + str(cert) + ",dst=/run/test/ca.pem,readonly",
                          "--mount", "type=bind,src=" + str(client_password) + ",dst=/run/test/password,readonly",
                          "-e", "FINANCE_MODE=simulation", "-e", "FINANCE_TLS_TEST=isolated-container",
                          "-e", "FINANCE_DB_HOST=finance-tls-test", "-e", "FINANCE_DB_NAME=tls_only",
                          "-e", "FINANCE_DB_USER=finance_tls_test", "-e", "FINANCE_DB_PASSWORD_FILE=/run/test/password",
                          "-e", "FINANCE_DB_TLS=verify-full", "-e", "FINANCE_DB_CA_FILE=/run/test/ca.pem",
                          "-e", "FINANCE_DB_POOL_MAX=1", "royal-finance-sim:local",
                          "node", "dist-finance-tools/finance-tls-smoke.js"], "verified_tls_check", timeout=90)
            checks = [json.loads(line) for line in output.decode().splitlines()]
            record("tls", True, checks=checks, temporary_network=True, live_database_modified=False)
        finally:
            run(["docker", "rm", "--force", container], "tls_database_cleanup", timeout=30)
            run(["docker", "network", "rm", network], "tls_network_cleanup", timeout=30)
except Exception as error:
    record("tls", False, error=str(error) if isinstance(error, OpsError) else type(error).__name__)
    raise SystemExit(1)
