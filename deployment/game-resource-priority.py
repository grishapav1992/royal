"""Reviewable live CPU priority change for the two existing Royal containers."""
import argparse
import copy
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid
from contextlib import contextmanager
from dataclasses import dataclass

DESIRED = {"game": 8192, "caddy": 4096}
HEALTH_URL = "https://stealth-spark-gokmxooi.expresshost.cloud/healthz"
HOST_FIELDS = (
    "CpuShares", "NanoCpus", "CpuQuota", "CpuPeriod", "CpuRealtimePeriod",
    "CpuRealtimeRuntime", "CpusetCpus", "CpusetMems", "Memory",
    "MemoryReservation", "MemorySwap", "MemorySwappiness", "PidsLimit",
    "BlkioWeight", "OomKillDisable", "CgroupParent",
)
LABEL_KEYS = (
    "com.docker.compose.project", "com.docker.compose.service",
    "com.docker.compose.project.config_files", "com.docker.compose.project.working_dir",
    "com.docker.compose.container-number", "com.docker.compose.oneoff",
)
MAX_FILE_BYTES = 256 * 1024
MAX_PLAN_BYTES = 32 * 1024
PLAN_SECONDS = 1800


class Refusal(Exception):
    def __init__(self, code, report=None):
        super().__init__(code)
        self.code, self.report = code, report


@dataclass(frozen=True)
class Settings:
    root: Path = Path("/opt/royal")
    backup_root: Path = Path("/opt/royal-backups")
    owner: int = 0
    health_url: str = HEALTH_URL
    legacy_source_owner: int = 502

    @property
    def files(self):
        return [self.root / "compose.yaml", self.root / "compose.override.yaml"]


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(value).hexdigest()


def now():
    return dt.datetime.now(dt.timezone.utc)


def path_owners(path, settings):
    owners = {settings.owner}
    if path in {settings.root, settings.files[0]}:
        owners.add(settings.legacy_source_owner)
    return owners


def secure_path(path, settings, directory=False, private=False):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise Refusal("unsafe-path")
    try:
        for ancestor in reversed(path.parents):
            value = ancestor.stat()
            if not stat.S_ISDIR(value.st_mode) or value.st_uid not in ({0} | path_owners(ancestor, settings)):
                raise Refusal("unsafe-path-owner")
            if value.st_mode & 0o022 and not (value.st_mode & stat.S_ISVTX):
                raise Refusal("writable-path-parent")
        value = path.lstat()
    except OSError:
        raise Refusal("missing-secure-path") from None
    valid_type = stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode)
    if not valid_type or value.st_uid not in path_owners(path, settings) or value.st_mode & 0o022:
        raise Refusal("unsafe-path-owner-or-mode")
    if not directory and value.st_nlink != 1:
        raise Refusal("unsafe-file-links")
    if private and value.st_mode & 0o077:
        raise Refusal("private-file-required")
    return value


def read_file(path, settings, private=False, maximum=MAX_FILE_BYTES):
    secure_path(path, settings, private=private)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        value = os.fstat(descriptor)
        if not stat.S_ISREG(value.st_mode) or value.st_uid not in path_owners(Path(path), settings) or value.st_nlink != 1 or (
                value.st_mode & (0o077 if private else 0o022)):
            raise Refusal("file-changed-during-read")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            data = stream.read(maximum + 1)
        if len(data) > maximum:
            raise Refusal("file-too-large")
        return data
    finally:
        os.close(descriptor)


def write_private(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def write_json(path, value):
    write_private(path, json.dumps(value, sort_keys=True, separators=(",", ":")).encode() + b"\n")


def source_metadata(settings):
    result = {}
    for path in settings.files:
        metadata = secure_path(path, settings)
        result[path.name] = {"uid": metadata.st_uid, "gid": metadata.st_gid,
                             "mode": stat.S_IMODE(metadata.st_mode)}
    return result


class System:
    def __init__(self, settings):
        self.settings = settings
        self.docker_binary = shutil.which("docker")
        self.curl_binary = shutil.which("curl")
        if not self.docker_binary or not self.curl_binary:
            raise Refusal("required-local-binary-missing")
        for binary in (self.docker_binary, self.curl_binary):
            secure_path(Path(binary).resolve(), settings)

    def command(self, args, timeout=15, maximum=1024 * 1024):
        environment = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                       "HOME": "/root", "LANG": "C.UTF-8"}
        # Command diagnostics and Compose interpolation remain in private temporary files.
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            try:
                result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=output, stderr=errors,
                                        env=environment, cwd=self.settings.root, timeout=timeout,
                                        check=False, close_fds=True)
            except (OSError, subprocess.SubprocessError):
                raise Refusal("bounded-command-failed") from None
            if result.returncode:
                raise Refusal("command-failed")
            output.seek(0)
            data = output.read(maximum + 1)
            if len(data) > maximum:
                raise Refusal("command-output-too-large")
            return data.decode("utf-8")

    def docker(self, *args, **limits):
        return self.command([self.docker_binary, "--host", "unix:///var/run/docker.sock", *args], **limits)

    def info(self):
        template = '{"version":{{json .CgroupVersion}},"driver":{{json .CgroupDriver}}}'
        return json.loads(self.docker("info", "--format", template, timeout=10, maximum=1024))

    def service_id(self, service):
        result = self.docker("ps", "--no-trunc", "--filter", "label=com.docker.compose.project=royal",
                             "--filter", "label=com.docker.compose.service=" + service,
                             "--format", "{{.ID}}", timeout=10, maximum=1024).strip().splitlines()
        if len(result) != 1 or not re.fullmatch(r"[a-f0-9]{64}", result[0]):
            raise Refusal("exactly-one-running-service-required")
        return result[0]

    def inspect(self, identifier):
        host = ",".join(json.dumps(key) + ":{{json .HostConfig." + key + "}}" for key in HOST_FIELDS)
        template = ('{"Id":{{json .Id}},"Image":{{json .Image}},"StartedAt":{{json .State.StartedAt}},'
                    '"Pid":{{json .State.Pid}},"Status":{{json .State.Status}},'
                    '"Paused":{{json .State.Paused}},"Restarting":{{json .State.Restarting}},'
                    '"allLabels":{{json .Config.Labels}},"HostConfig":{' + host + '}}')
        data = json.loads(self.docker("inspect", "--type", "container", "--format", template,
                                     identifier, timeout=10, maximum=64 * 1024))
        labels = data.pop("allLabels")
        if not isinstance(labels, dict) or len(labels) > 256 or any(
                not isinstance(key, str) or not isinstance(value, str) or len(value) > 4096
                for key, value in labels.items()):
            raise Refusal("invalid-container-labels")
        data["labels"] = {key: labels.get(key) for key in LABEL_KEYS}
        data["labelFingerprint"] = digest(labels)
        return data

    def weight(self, container):
        path = f"/system.slice/docker-{container['Id']}.scope"
        entries = Path(f"/proc/{container['Pid']}/cgroup").read_text().strip().splitlines()
        if entries != ["0::" + path]:
            raise Refusal("unexpected-container-cgroup")
        directory = Path("/sys/fs/cgroup") / path.lstrip("/")
        if directory.resolve() != directory:
            raise Refusal("unsafe-container-cgroup")
        weight = int((directory / "cpu.weight").read_text().strip())
        if not 1 <= weight <= 10000:
            raise Refusal("invalid-kernel-cpu-weight")
        return {"path": path, "weight": weight}

    def merged(self):
        data = self.docker("compose", "--project-directory", str(self.settings.root),
                           "--env-file", str(self.settings.root / ".env"), "--project-name", "royal",
                           "-f", str(self.settings.files[0]), "-f", str(self.settings.files[1]),
                           "config", "--format", "json", timeout=30, maximum=8 * 1024 * 1024)
        value = json.loads(data)
        if not isinstance(value, dict) or not isinstance(value.get("services"), dict) or any(
                not isinstance(value["services"].get(service), dict) for service in DESIRED):
            raise Refusal("invalid-merged-compose-schema")
        return value

    def update(self, identifier, shares):
        self.docker("update", "--cpu-shares", str(shares), identifier, timeout=15, maximum=1024)

    def tag(self, image, tag):
        if self.docker("image", "ls", "--quiet", "--no-trunc", tag, timeout=10, maximum=1024).strip():
            raise Refusal("previous-image-tag-already-exists")
        self.docker("image", "tag", image, tag, timeout=15, maximum=1024)
        if self.docker("image", "inspect", "--format", "{{.Id}}", tag, timeout=10, maximum=1024).strip() != image:
            raise Refusal("previous-image-tag-verification-failed")

    def health(self):
        status = self.command([self.curl_binary, "--noproxy", "*", "--silent", "--show-error",
                               "--output", "/dev/null", "--write-out", "%{http_code}",
                               "--connect-timeout", "3", "--max-time", "5", self.settings.health_url],
                              timeout=8, maximum=16)
        if status.strip() != "200":
            raise Refusal("public-health-not-200")


def validate_snapshot(value, service, settings):
    keys = {"Id", "Image", "StartedAt", "Pid", "Status", "Paused", "Restarting", "labels",
            "labelFingerprint", "HostConfig"}
    if not isinstance(value, dict) or set(value) != keys:
        raise Refusal("invalid-container-snapshot")
    if not re.fullmatch(r"[a-f0-9]{64}", str(value["Id"])) or not re.fullmatch(
            r"sha256:[a-f0-9]{64}", str(value["Image"])):
        raise Refusal("invalid-container-identity")
    if not isinstance(value["StartedAt"], str) or not re.fullmatch(
            r"[0-9T:.+Z-]{20,64}", value["StartedAt"]):
        raise Refusal("invalid-container-start-time")
    if type(value["Pid"]) is not int or value["Pid"] <= 0 or value["Status"] != "running" or (
            value["Paused"] is not False or value["Restarting"] is not False):
        raise Refusal("container-not-stably-running")
    labels = dict(zip(LABEL_KEYS, ["royal", service, ",".join(map(str, settings.files)),
                                 str(settings.root), "1", "False"]))
    if value["labels"] != labels or not re.fullmatch(r"[a-f0-9]{64}", str(value["labelFingerprint"])):
        raise Refusal("container-compose-ownership-mismatch")
    resources = value["HostConfig"]
    if not isinstance(resources, dict) or set(resources) != set(HOST_FIELDS):
        raise Refusal("invalid-host-config-schema")
    for key, field in resources.items():
        if key in {"CpusetCpus", "CpusetMems", "CgroupParent"}:
            valid = isinstance(field, str) and len(field) <= 256
        elif key == "OomKillDisable":
            valid = field is None or type(field) is bool
        else:
            valid = field is None and key in {"MemorySwappiness", "PidsLimit"} or type(field) is int
        if not valid:
            raise Refusal("invalid-host-resource-type")
    if not 0 <= resources["CpuShares"] <= 262144:
        raise Refusal("invalid-old-cpu-shares")


def capture(system, service, settings, identifier=None):
    identifier = identifier or system.service_id(service)
    value = system.inspect(identifier)
    validate_snapshot(value, service, settings)
    if value["Id"] != identifier or system.service_id(service) != identifier:
        raise Refusal("container-replaced-during-capture")
    kernel = system.weight(value)
    if system.inspect(identifier) != value:
        raise Refusal("container-changed-during-capture")
    return {"snapshot": value, "kernel": kernel}


def resource_comparison(value):
    result = copy.deepcopy(value)
    for service in DESIRED:
        result["services"][service].pop("cpu_shares", None)
    return result


def patch_compose(data):
    try:
        lines = data.decode("utf-8").splitlines(keepends=True)
    except UnicodeError:
        raise Refusal("compose-must-be-utf8") from None
    starts = [index for index, line in enumerate(lines) if re.fullmatch(r"services:\r?\n", line)]
    if len(starts) != 1:
        raise Refusal("unsupported-compose-services-layout")
    first = starts[0] + 1
    last = next((index for index in range(first, len(lines)) if re.match(r"^[A-Za-z_]", lines[index])), len(lines))
    edits = []
    for service, shares in DESIRED.items():
        headers = [index for index in range(first, last)
                   if re.fullmatch("  " + service + r":\r?\n", lines[index])]
        if len(headers) != 1:
            raise Refusal("unsupported-compose-service-layout")
        header = headers[0]
        end = next((index for index in range(header + 1, last) if re.match(r"^  [^ #]", lines[index])), last)
        fields = [index for index in range(header + 1, end) if re.match(r"^    cpu_shares\s*:", lines[index])]
        if len(fields) > 1:
            raise Refusal("duplicate-compose-cpu-shares")
        newline = "\r\n" if lines[header].endswith("\r\n") else "\n"
        if fields:
            index = fields[0]
            match = re.fullmatch(r"(    cpu_shares: *)([0-9]+)( *(?:#[^\r\n]*)?)(\r?\n)?", lines[index])
            if not match:
                raise Refusal("unsupported-compose-cpu-shares")
            edits.append((index, 1, match[1] + str(shares) + match[3] + (match[4] or "")))
        else:
            edits.append((header + 1, 0, f"    cpu_shares: {shares}" + newline))
    for index, length, replacement in sorted(edits, reverse=True):
        lines[index:index + length] = [replacement]
    return "".join(lines).encode()


def make_plan(system, settings):
    secure_path(settings.root, settings, directory=True)
    secure_path(settings.root / ".env", settings)
    originals = [read_file(path, settings) for path in settings.files]
    metadata = source_metadata(settings)
    if system.info() != {"version": "2", "driver": "systemd"}:
        raise Refusal("requires-cgroup-v2-systemd")
    merged = system.merged()
    containers = {service: capture(system, service, settings) for service in DESIRED}
    for service, entry in containers.items():
        if entry["snapshot"]["HostConfig"]["CpuShares"] >= DESIRED[service]:
            raise Refusal("priority-already-set-or-higher")
        if entry["snapshot"]["HostConfig"]["CpuShares"] == 0 and entry["kernel"]["weight"] != 100:
            raise Refusal("unsupported-default-kernel-weight")
    system.health()
    if originals != [read_file(path, settings) for path in settings.files] or source_metadata(settings) != metadata:
        raise Refusal("compose-changed-during-plan")
    timestamp = now()
    return {"protocol": 1, "createdAt": timestamp.isoformat(),
            "expiresAt": (timestamp + dt.timedelta(seconds=PLAN_SECONDS)).isoformat(),
            "root": str(settings.root), "composeFiles": list(map(str, settings.files)),
            "sourceMetadata": metadata,
            "composeSha256": digest(originals[0]), "overrideSha256": digest(originals[1]),
            "mergedSha256": digest(merged), "healthUrl": settings.health_url,
            "desired": dict(DESIRED), "containers": containers}


def validate_plan(plan, settings):
    keys = {"protocol", "createdAt", "expiresAt", "root", "composeFiles", "composeSha256",
            "overrideSha256", "mergedSha256", "healthUrl", "desired", "containers", "sourceMetadata"}
    if not isinstance(plan, dict) or set(plan) != keys or type(plan["protocol"]) is not int or plan["protocol"] != 1:
        raise Refusal("invalid-plan-schema")
    if plan["root"] != str(settings.root) or plan["composeFiles"] != list(map(str, settings.files)) or (
            plan["healthUrl"] != settings.health_url or plan["desired"] != DESIRED):
        raise Refusal("plan-target-mismatch")
    for field in ("composeSha256", "overrideSha256", "mergedSha256"):
        if not isinstance(plan[field], str) or not re.fullmatch(r"[a-f0-9]{64}", plan[field]):
            raise Refusal("invalid-plan-digest")
    metadata = plan["sourceMetadata"]
    if not isinstance(metadata, dict) or set(metadata) != {path.name for path in settings.files}:
        raise Refusal("invalid-source-metadata")
    for path in settings.files:
        value = metadata[path.name]
        if not isinstance(value, dict) or set(value) != {"uid", "gid", "mode"} or any(
                type(value[key]) is not int or value[key] < 0 for key in value) or (
                value["uid"] not in path_owners(path, settings) or value["mode"] > 0o777 or value["mode"] & 0o022):
            raise Refusal("invalid-source-metadata")
    try:
        created, expires = (dt.datetime.fromisoformat(plan[key]) for key in ("createdAt", "expiresAt"))
        duration = (expires - created).total_seconds()
        valid = created.tzinfo is not None and expires.tzinfo is not None and 0 < duration <= PLAN_SECONDS and created <= now() < expires
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise Refusal("expired-or-invalid-plan")
    if not isinstance(plan["containers"], dict) or set(plan["containers"]) != set(DESIRED):
        raise Refusal("invalid-plan-containers")
    for service, entry in plan["containers"].items():
        if not isinstance(entry, dict) or set(entry) != {"snapshot", "kernel"}:
            raise Refusal("invalid-plan-container-entry")
        validate_snapshot(entry["snapshot"], service, settings)
        kernel = entry["kernel"]
        if not isinstance(kernel, dict) or set(kernel) != {"path", "weight"} or kernel["path"] != (
                "/system.slice/docker-" + entry["snapshot"]["Id"] + ".scope") or (
                type(kernel["weight"]) is not int or not 1 <= kernel["weight"] <= 10000):
            raise Refusal("invalid-plan-kernel-snapshot")
        if entry["snapshot"]["HostConfig"]["CpuShares"] >= DESIRED[service] or (
                entry["snapshot"]["HostConfig"]["CpuShares"] == 0 and kernel["weight"] != 100):
            raise Refusal("unsupported-plan-priority-baseline")


@contextmanager
def locked(settings):
    path = settings.root / ".game-resource-priority.lock"
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        value = os.fstat(descriptor)
        if not stat.S_ISREG(value.st_mode) or value.st_uid != settings.owner or value.st_nlink != 1 or value.st_mode & 0o077:
            raise Refusal("unsafe-operation-lock")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refusal("priority-operation-already-running") from None
        yield
    finally:
        os.close(descriptor)


def replace_if_current(path, expected, replacement, settings):
    metadata = secure_path(path, settings)
    if read_file(path, settings) != expected:
        raise Refusal("compose-changed-refusing-overwrite")
    descriptor, temporary = tempfile.mkstemp(prefix=".cpu-priority-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(replacement)
            output.flush()
            os.fchmod(output.fileno(), stat.S_IMODE(metadata.st_mode))
            os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
            os.fsync(output.fileno())
        if read_file(path, settings) != expected:
            raise Refusal("compose-changed-refusing-overwrite")
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def check_live(system, settings, plan, changed):
    result = {}
    for service, entry in plan["containers"].items():
        current = capture(system, service, settings, entry["snapshot"]["Id"])
        expected = copy.deepcopy(entry["snapshot"])
        if service in changed:
            expected["HostConfig"]["CpuShares"] = DESIRED[service]
        if current["snapshot"] != expected:
            raise Refusal("live-container-snapshot-changed")
        if service in changed:
            valid = current["kernel"]["path"] == entry["kernel"]["path"] and current["kernel"]["weight"] > entry["kernel"]["weight"]
        else:
            valid = current["kernel"] == entry["kernel"]
        if not valid:
            raise Refusal("kernel-cpu-weight-verification-failed")
        result[service] = {"cpuShares": current["snapshot"]["HostConfig"]["CpuShares"],
                           "cpuWeight": current["kernel"]["weight"]}
    return result


def rollback(system, settings, plan, attempted, original, modified):
    result = {"containers": {}, "compose": "unchanged"}
    for service in reversed(list(attempted)):
        entry = plan["containers"][service]
        try:
            current = capture(system, service, settings, entry["snapshot"]["Id"])
            comparison = copy.deepcopy(current["snapshot"])
            shares = comparison["HostConfig"]["CpuShares"]
            comparison["HostConfig"]["CpuShares"] = entry["snapshot"]["HostConfig"]["CpuShares"]
            if comparison != entry["snapshot"] or shares not in {DESIRED[service], entry["snapshot"]["HostConfig"]["CpuShares"]}:
                raise Refusal("rollback-container-changed")
            original_shares = entry["snapshot"]["HostConfig"]["CpuShares"]
            target = original_shares or 1024
            if current == entry:
                restored, target = current, original_shares
            else:
                # Docker zero-reset is a no-op on this host. Its tested explicit equivalent is 1024.
                system.update(entry["snapshot"]["Id"], target)
                restored = capture(system, service, settings, entry["snapshot"]["Id"])
            expected = copy.deepcopy(entry)
            expected["snapshot"]["HostConfig"]["CpuShares"] = target
            if restored != expected:
                raise Refusal("rollback-resource-not-restored")
            result["containers"][service] = {"status": "restored", "originalCpuShares": original_shares,
                                              "restoredCpuShares": target, "cpuWeight": restored["kernel"]["weight"],
                                              "exactMetadataRestore": target == original_shares,
                                              "equivalentPolicyRestore": target != original_shares}
        except Exception as error:
            result["containers"][service] = {"status": error.code if isinstance(error, Refusal) else "rollback-verification-failed"}
    try:
        current = read_file(settings.files[0], settings)
        if current == modified:
            replace_if_current(settings.files[0], modified, original, settings)
            result["compose"] = "restored"
        elif current != original:
            result["compose"] = "refused-concurrent-file-change"
    except (Refusal, OSError):
        result["compose"] = "restore-failed"
    result["complete"] = result["compose"] in {"restored", "unchanged"} and all(
        value["status"] == "restored" for value in result["containers"].values())
    result["exactMetadataRestore"] = result["complete"] and all(
        value["exactMetadataRestore"] for value in result["containers"].values())
    result["equivalentPolicyRestore"] = result["complete"] and not result["exactMetadataRestore"]
    return result


def apply_plan(system, settings, plan, backup_directory):
    validate_plan(plan, settings)
    secure_path(settings.root, settings, directory=True)
    secure_path(settings.root / ".env", settings)
    secure_path(settings.backup_root, settings, directory=True)
    backup_directory = Path(backup_directory)
    if backup_directory.parent != settings.backup_root or not re.fullmatch(r"game-resource-priority-[A-Za-z0-9-]{8,100}", backup_directory.name):
        raise Refusal("invalid-private-backup-directory")
    with locked(settings):
        originals = [read_file(path, settings) for path in settings.files]
        if source_metadata(settings) != plan["sourceMetadata"]:
            raise Refusal("planned-source-metadata-changed")
        if [digest(data) for data in originals] != [plan["composeSha256"], plan["overrideSha256"]]:
            raise Refusal("planned-compose-files-changed")
        if system.info() != {"version": "2", "driver": "systemd"}:
            raise Refusal("requires-cgroup-v2-systemd")
        before = system.merged()
        if digest(before) != plan["mergedSha256"]:
            raise Refusal("planned-merged-config-changed")
        check_live(system, settings, plan, set())
        system.health()
        modified = patch_compose(originals[0])
        backup_directory.mkdir(mode=0o700)
        secure_path(backup_directory, settings, directory=True, private=True)
        for path, data in zip(settings.files, originals):
            write_private(backup_directory / path.name, data)
        write_json(backup_directory / "plan.json", plan)
        tag = "royal-game:before-resource-priority-" + uuid.uuid4().hex
        report = {"ok": False, "backupDirectory": str(backup_directory), "previousGameImageTag": tag,
                  "restartRequested": False, "memoryOrQuotaChanged": False}
        attempted, changed = [], set()
        try:
            system.tag(plan["containers"]["game"]["snapshot"]["Image"], tag)
            check_live(system, settings, plan, changed)
            replace_if_current(settings.files[0], originals[0], modified, settings)
            after = system.merged()
            if resource_comparison(before) != resource_comparison(after) or any(
                    after["services"][service].get("cpu_shares") != shares for service, shares in DESIRED.items()):
                raise Refusal("merged-config-changed-beyond-cpu-shares")
            for service, shares in DESIRED.items():
                if read_file(settings.files[0], settings) != modified or read_file(settings.files[1], settings) != originals[1]:
                    raise Refusal("compose-changed-during-apply")
                if source_metadata(settings) != plan["sourceMetadata"]:
                    raise Refusal("source-metadata-changed-during-apply")
                check_live(system, settings, plan, changed)
                attempted.append(service)
                system.update(plan["containers"][service]["snapshot"]["Id"], shares)
                changed.add(service)
                check_live(system, settings, plan, changed)
            report["resources"] = check_live(system, settings, plan, changed)
            system.health()
            if read_file(settings.files[0], settings) != modified or read_file(settings.files[1], settings) != originals[1]:
                raise Refusal("compose-changed-after-apply")
            if source_metadata(settings) != plan["sourceMetadata"]:
                raise Refusal("source-metadata-changed-after-apply")
            check_live(system, settings, plan, changed)
            report["ok"] = True
            report["identityPreserved"] = True
            report["publicHealthStatus"] = 200
            write_json(backup_directory / "result.json", report)
            return report
        except (Exception, KeyboardInterrupt) as error:
            report["ok"] = False
            report["error"] = error.code if isinstance(error, Refusal) else "safe-operation-failed"
            report["rollback"] = rollback(system, settings, plan, attempted, originals[0], modified)
            try:
                write_json(backup_directory / "failure.json", report)
            except OSError:
                report["failureReportSaved"] = False
            raise Refusal(report["error"], report) from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    modes.add_parser("plan", help="Read-only safe JSON snapshot; save it in a private file for review.")
    apply = modes.add_parser("apply", help="Apply a reviewed private plan without recreating containers.")
    apply.add_argument("--plan", type=Path, required=True)
    apply.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if os.geteuid() != 0:
            raise Refusal("root-required-for-exact-live-inspection")
        settings = Settings()
        system = System(settings)
        if args.mode == "plan":
            result = make_plan(system, settings)
        else:
            def interrupted(signum, frame):
                signal.signal(signal.SIGINT, signal.SIG_IGN)
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                raise Refusal("operation-interrupted")
            signal.signal(signal.SIGINT, interrupted)
            signal.signal(signal.SIGTERM, interrupted)
            plan = json.loads(read_file(args.plan, settings, private=True, maximum=MAX_PLAN_BYTES))
            result = apply_plan(system, settings, plan, args.backup_dir)
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        return 0
    except (Refusal, OSError, ValueError, TypeError, KeyError) as error:
        if isinstance(error, Refusal):
            value = error.report or {"ok": False, "error": error.code}
        else:
            value = {"ok": False, "error": "safe-operation-failed"}
        print(json.dumps(value, sort_keys=True, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    sys.exit(main())
