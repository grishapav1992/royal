import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).parents[1] / "prepare-load-stand-postgres.py"
SPEC = importlib.util.spec_from_file_location("prepare_native", MODULE)
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class OfflinePostgresPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive, self.lock, self.output = [self.root / name for name in ("native.tgz", "package-lock.json", "prepared")]

    def fixture(self, additions=(), links=None, metadata=None):
        rows = links if links is not None else [{"source": "native/lib/libpq.so.5", "target": "native/lib/libpq.so"}]
        files = {"package/package.json": json.dumps(metadata or {"name": native.PACKAGE, "version": "test.1"}).encode(),
                 "package/native/pg-symlinks.json": json.dumps(rows).encode(),
                 "package/native/lib/libpq.so.5": b"library"}
        for name in ("postgres", "initdb", "pg_ctl"):
            files["package/native/bin/" + name] = b"fixture-binary-never-executed"
        with tarfile.open(self.archive, "w:gz") as tar:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size, member.mode = len(data), 0o755 if "/bin/" in name else 0o644
                tar.addfile(member, io.BytesIO(data))
            for member, data in additions:
                tar.addfile(member, io.BytesIO(data) if data is not None else None)
        digest = base64.b64encode(hashlib.sha512(self.archive.read_bytes()).digest()).decode()
        self.lock.write_text(json.dumps({"packages": {"node_modules/" + native.PACKAGE: {"version": "test.1", "integrity": "sha512-" + digest}}}))

    def run_prepare(self):
        return native.prepare(self.archive, self.lock, self.output)

    def fails(self, code):
        with self.assertRaisesRegex(native.PreparationError, "^" + code + "$"):
            self.run_prepare()
        self.assertFalse(self.output.exists())

    def test_valid_package_links_are_relative_and_survive_move(self):
        self.fixture()
        result = self.run_prepare()
        link = self.output / "package/native/lib/libpq.so"
        self.assertEqual(link.readlink(), Path("libpq.so.5"))
        self.assertEqual(link.read_bytes(), b"library")
        self.assertEqual(result["hydratedRelativeLinks"], 1)
        self.assertFalse(result["binariesExecuted"])
        self.assertTrue((self.output / "package/native/bin/postgres").stat().st_mode & 0o100)
        moved = self.root / "relocated"
        self.output.rename(moved)
        self.assertEqual((moved / "package/native/lib/libpq.so").read_bytes(), b"library")

    def test_integrity_mismatch_precedes_output_creation(self):
        self.fixture()
        with self.archive.open("ab") as stream:
            stream.write(b"tampered")
        self.fails("lock-integrity-mismatch")

    def test_missing_or_non_sha512_lock_is_refused(self):
        self.fixture()
        for integrity in (None, "sha256-AAAA", "sha512-AAAA", "sha512-???"):
            with self.subTest(integrity=integrity):
                self.lock.write_text(json.dumps({"packages": {"node_modules/" + native.PACKAGE: {"version": "test.1", "integrity": integrity}}}))
                self.fails("required-lock-sha512-unavailable")

    def test_unsafe_member_paths_cannot_write_outside(self):
        for name in ("/outside", "../outside", "package/../outside", "package/native/../../outside", "elsewhere/file", "package\\outside", "package//outside"):
            with self.subTest(name=name):
                m = tarfile.TarInfo(name)
                m.size = 1
                self.fixture([(m, b"x")])
                self.fails("unsafe-package-path")
                self.assertFalse((self.root / "outside").exists())

    def test_archive_links_and_devices_are_refused(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind):
                m = tarfile.TarInfo("package/native/lib/unsafe")
                m.type, m.linkname = kind, "../../../../outside"
                self.fixture([(m, None)])
                self.fails("unsupported-tar-entry")

    def test_duplicate_archive_entry_is_refused(self):
        m = tarfile.TarInfo("package/native/lib/libpq.so.5")
        m.size = 1
        self.fixture([(m, b"x")])
        self.fails("duplicate-tar-path")

    def test_manifest_escape_absolute_or_duplicate_target_is_refused(self):
        for rows, code in [
            ([{"source": "../outside", "target": "native/lib/x"}], "unsafe-package-path"),
            ([{"source": "native/lib/libpq.so.5", "target": "/tmp/outside"}], "unsafe-package-path"),
            ([{"source": "package/package.json", "target": "native/lib/x"}], "unsafe-package-path"),
            ([{"source": "native/lib/libpq.so.5", "target": "native/../outside"}], "unsafe-package-path"),
            ([{"source": "native/lib/libpq.so.5", "target": "native/lib/x"}] * 2, "native-link-target-collision"),
        ]:
            with self.subTest(rows=rows):
                self.fixture(links=rows)
                self.fails(code)

    def test_manifest_missing_source_and_existing_target_are_refused(self):
        self.fixture(links=[{"source": "native/lib/missing", "target": "native/lib/x"}])
        self.fails("native-link-source-unavailable")
        self.fixture(links=[{"source": "native/lib/libpq.so.5", "target": "native/lib/libpq.so.5"}])
        self.fails("native-link-target-collision")

    def test_archive_entry_file_total_and_expanded_limits(self):
        self.fixture()
        for setting, value, code in [("MAX_ARCHIVE_BYTES", 1, "archive-byte-limit"), ("MAX_ENTRIES", 1, "tar-entry-limit"),
                                     ("MAX_FILE_BYTES", 1, "tar-file-byte-limit"), ("MAX_TOTAL_BYTES", 1, "tar-total-byte-limit"),
                                     ("MAX_TAR_BYTES", 1, "tar-expanded-byte-limit")]:
            with self.subTest(setting=setting), patch.object(native, setting, value):
                self.fails(code)

    def test_existing_output_is_preserved(self):
        self.fixture()
        self.output.mkdir()
        marker = self.output / "keep"
        marker.write_bytes(b"keep")
        with self.assertRaisesRegex(native.PreparationError, "output-already-exists"):
            self.run_prepare()
        self.assertEqual(marker.read_bytes(), b"keep")

    def test_lock_and_package_identity_must_match(self):
        self.fixture(metadata={"name": native.PACKAGE, "version": "different"})
        self.fails("package-identity-mismatch")


if __name__ == "__main__":
    unittest.main()
