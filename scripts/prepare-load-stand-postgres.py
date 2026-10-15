#!/usr/bin/env python3
"""Prepare a lock-verified native PostgreSQL npm package offline without running binaries."""
import argparse
import base64
import gzip
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile

PACKAGE = "@embedded-postgres/linux-x64"
MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_ENTRIES = 20000
MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_TAR_BYTES = MAX_TOTAL_BYTES + MAX_ENTRIES * 1024
MAX_JSON_BYTES = 1024 * 1024
MAX_LINKS = 1024


class PreparationError(Exception):
    pass


class BoundedReader:
    def __init__(self, reader):
        self.reader, self.used = reader, 0

    def read(self, size):
        if size < 0 or size > MAX_TAR_BYTES - self.used:
            raise PreparationError("tar-expanded-byte-limit")
        value = self.reader.read(size)
        self.used += len(value)
        return value


def relative_path(value, prefix):
    if not isinstance(value, str) or len(value) > 1024 or "\\" in value or "\0" in value:
        raise PreparationError("unsafe-package-path")
    value = value.removesuffix("/")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts) or parts[0] != prefix:
        raise PreparationError("unsafe-package-path")
    return PurePosixPath(value)


def read_json(path, limit=MAX_JSON_BYTES):
    with path.open("rb") as stream:
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise PreparationError("json-byte-limit")
    try:
        return json.loads(value)
    except (UnicodeError, ValueError):
        raise PreparationError("invalid-package-json") from None


def lock_record(lockfile, package):
    lock = read_json(Path(lockfile), 16 * 1024 * 1024)
    try:
        record = lock["packages"]["node_modules/" + package]
        integrity, version = record["integrity"], record["version"]
        if not isinstance(version, str) or not isinstance(integrity, str) or not integrity.startswith("sha512-"):
            raise ValueError()
        digest = base64.b64decode(integrity[7:], validate=True)
        if len(digest) != 64:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise PreparationError("required-lock-sha512-unavailable") from None
    return version, integrity, digest


def hash_archive(stream):
    digest, size = hashlib.sha512(), 0
    while chunk := stream.read(65536):
        size += len(chunk)
        if size > MAX_ARCHIVE_BYTES:
            raise PreparationError("archive-byte-limit")
        digest.update(chunk)
    stream.seek(0)
    return digest.digest(), size


def hydrate_links(package_root):
    native = (package_root / "native").resolve()
    rows = read_json(native / "pg-symlinks.json")
    if not isinstance(rows, list) or len(rows) > MAX_LINKS:
        raise PreparationError("invalid-native-link-manifest")
    plans, targets = [], set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"source", "target"}:
            raise PreparationError("invalid-native-link-manifest")
        source = package_root / str(relative_path(row["source"], "native"))
        target = package_root / str(relative_path(row["target"], "native"))
        if native not in source.resolve().parents or native not in target.resolve().parents:
            raise PreparationError("native-link-escape")
        if not source.is_file() or source.is_symlink():
            raise PreparationError("native-link-source-unavailable")
        if target.exists() or target.is_symlink() or target in targets:
            raise PreparationError("native-link-target-collision")
        targets.add(target)
        plans.append((source, target))
    for source, target in plans:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(os.path.relpath(source, target.parent))
    return len(plans)


def prepare(archive, lockfile, output, package=PACKAGE):
    if package != PACKAGE:
        raise PreparationError("unsupported-native-package")
    version, integrity, expected = lock_record(lockfile, package)
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise PreparationError("output-already-exists")
    created = False
    try:
        with Path(archive).open("rb") as compressed:
            digest, archive_size = hash_archive(compressed)
            if not hmac.compare_digest(digest, expected):
                raise PreparationError("lock-integrity-mismatch")
            output.parent.mkdir(parents=True, exist_ok=True)
            output.mkdir(mode=0o700)
            created = True
            entries, extracted_bytes, seen = 0, 0, set()
            with gzip.GzipFile(fileobj=compressed) as expanded:
                with tarfile.open(fileobj=BoundedReader(expanded), mode="r|") as tar:
                    for member in tar:
                        entries += 1
                        if entries > MAX_ENTRIES:
                            raise PreparationError("tar-entry-limit")
                        path = relative_path(member.name, "package")
                        if path in seen:
                            raise PreparationError("duplicate-tar-path")
                        seen.add(path)
                        if not (member.isdir() or member.isfile()) or member.sparse is not None:
                            raise PreparationError("unsupported-tar-entry")
                        if str(path) == "package" and not member.isdir():
                            raise PreparationError("invalid-package-root")
                        target = output / str(path)
                        if member.isdir():
                            target.mkdir(parents=True, exist_ok=True)
                            continue
                        if member.size < 0 or member.size > MAX_FILE_BYTES:
                            raise PreparationError("tar-file-byte-limit")
                        extracted_bytes += member.size
                        if extracted_bytes > MAX_TOTAL_BYTES:
                            raise PreparationError("tar-total-byte-limit")
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with tar.extractfile(member) as source, target.open("xb") as destination:
                            shutil.copyfileobj(source, destination, 65536)
                        target.chmod(0o755 if member.mode & 0o111 else 0o644)
            package_root = output / "package"
            metadata = read_json(package_root / "package.json")
            if not isinstance(metadata, dict) or metadata.get("name") != package or metadata.get("version") != version:
                raise PreparationError("package-identity-mismatch")
            for binary in ("postgres", "initdb", "pg_ctl"):
                if not (package_root / "native" / "bin" / binary).is_file():
                    raise PreparationError("native-binary-unavailable")
            links = hydrate_links(package_root)
            # Check the same open archive again before publishing success.
            compressed.seek(0)
            final_digest, final_size = hash_archive(compressed)
            if final_size != archive_size or not hmac.compare_digest(final_digest, expected):
                raise PreparationError("archive-changed-during-preparation")
        return {"package": package, "version": version, "integrity": integrity,
                "sha512": digest.hex(), "archiveBytes": archive_size, "entries": entries,
                "extractedBytes": extracted_bytes, "hydratedRelativeLinks": links,
                "output": str(output), "packagePath": str(package_root), "binariesExecuted": False}
    except Exception:
        if created:
            shutil.rmtree(output)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--lockfile", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.archive, args.lockfile, args.output), ensure_ascii=True, indent=2))
    except Exception as error:
        code = str(error) if isinstance(error, PreparationError) else "offline-native-preparation-failed"
        print(json.dumps({"ok": False, "error": code}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
