#!/usr/bin/env python3
"""Bounded Linux host monitor that can stop only its labeled load-test container."""
import argparse
import concurrent.futures
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request

HEALTH_URL = "https://stealth-spark-gokmxooi.expresshost.cloud/healthz"
MAX_SECONDS, MAX_LINES = 2400, 2700
ENDED = {"exited", "dead", "removing"}


class Refused(RuntimeError):
    pass


def validate(container, run_id, max_seconds, health_url):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", run_id):
        raise Refused("invalid-run-id")
    prefix = "royal-load-" + run_id
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", container) or not (container == prefix or container.startswith(prefix + "-")):
        raise Refused("invalid-test-container-name")
    if not isinstance(max_seconds, int) or not 1 <= max_seconds <= MAX_SECONDS or health_url != HEALTH_URL:
        raise Refused("invalid-guard-limit-or-health-url")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class HealthWorker:
    def submit(self, function, *args):
        future = concurrent.futures.Future()

        def run():
            try:
                future.set_result(function(*args))
            except Exception as error:
                future.set_exception(error)

        threading.Thread(target=run, name="load-health", daemon=True).start()
        return future


class System:
    now, sleep = staticmethod(time.monotonic), staticmethod(time.sleep)

    def inspect(self, container):
        template = '{{json .State.Status}}\n{{json (index .Config.Labels "royal.load.run-id")}}'
        try:
            result = subprocess.run(["docker", "inspect", "--type", "container", "--format", template, container],
                                    capture_output=True, text=True, timeout=10)
            if result.returncode != 0 or len(result.stdout) > 4096:
                raise Refused("container-inspection-failed")
            status, label = map(json.loads, result.stdout.strip().splitlines())
            if status not in {"created", "running", "paused", "restarting", *ENDED}:
                raise Refused("invalid-container-status")
            return status, label
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
            raise Refused("container-inspection-failed") from None

    def stop(self, container):
        try:
            result = subprocess.run(["docker", "stop", "-t", "5", container],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            if result.returncode != 0:
                raise Refused("owned-container-stop-failed")
        except (OSError, subprocess.TimeoutExpired):
            raise Refused("owned-container-stop-failed") from None

    def kill(self, container):
        try:
            result = subprocess.run(["docker", "kill", container],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            if result.returncode != 0:
                raise Refused("owned-container-kill-failed")
        except (OSError, subprocess.TimeoutExpired):
            raise Refused("owned-container-kill-failed") from None

    def resources(self):
        fields = Path("/proc/stat").read_text().splitlines()[0].split()
        values = [int(value) for value in fields[1:9]]
        if fields[0] != "cpu" or len(values) != 8 or min(values) < 0:
            raise ValueError("invalid-cpu-sample")
        memory = re.search(r"^MemAvailable:\s+(\d+) kB$", Path("/proc/meminfo").read_text(), re.M)
        if not memory:
            raise ValueError("missing-memory-sample")
        pressure = {}
        for resource in ("cpu", "memory", "io"):
            try:
                for line in Path("/proc/pressure/" + resource).read_text().splitlines():
                    kind, *numbers = line.split()
                    if kind not in {"some", "full"}:
                        continue
                    for pair in numbers:
                        key, value = pair.split("=")
                        numeric = float(value)
                        if key in {"avg10", "avg60", "avg300", "total"} and math.isfinite(numeric) and numeric >= 0:
                            pressure[resource + "." + kind + "." + key] = numeric
            except (OSError, ValueError):
                pass
        return sum(values), values[3] + values[4], int(memory[1]) / 1024, pressure

    def health(self, url):
        started = self.now()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            with opener.open(urllib.request.Request(url, method="GET"), timeout=3) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
        except (OSError, urllib.error.URLError):
            status = None
        return {"status": status, "latencyMs": (self.now() - started) * 1000}


def monitor(container, run_id, output, max_seconds, health_url=HEALTH_URL, system=None, executor=None):
    validate(container, run_id, max_seconds, health_url)
    system = system or System()
    pool = executor or HealthWorker()
    output = Path(output)
    samples_path = output.with_suffix(".jsonl")
    if output.suffix != ".json" or output.exists() or samples_path.exists():
        raise Refused("guard-output-exists-or-invalid")
    output.parent.mkdir(parents=True, exist_ok=True)
    summary = {"container": container, "runId": run_id, "reason": "guard-error", "stopped": False, "samples": 0,
               "healthChecks": 0, "maxCpuPercent": 0, "minMemAvailableMiB": None, "maxHealthLatencyMs": 0,
               "stopFallback": False}
    started = system.now()
    previous, future, next_health = None, None, started
    health_deadline, health_timed_out = None, False
    low_memory = high_cpu = bad_health = slow_health = 0

    def owned_status():
        try:
            status, label = system.inspect(container)
        except Refused:
            raise
        except Exception:
            raise Refused("container-inspection-failed") from None
        if label != run_id:
            raise Refused("container-label-mismatch")
        return status

    def stop_owned(reason):
        summary["reason"] = reason
        if owned_status() in ENDED:
            summary["reason"] = "container-ended"
            return
        try:
            system.stop(container)
            summary["terminationMethod"] = "stop"
        except (KeyboardInterrupt, Exception):
            summary["stopFallback"] = True
            if owned_status() not in ENDED:
                try:
                    system.kill(container)
                except (KeyboardInterrupt, Exception):
                    raise Refused("owned-container-kill-failed") from None
                summary["terminationMethod"] = "kill"
            else:
                summary["terminationMethod"] = "ended-after-stop-error"
        summary["stopped"] = True

    try:
        owned_status()
        with os.fdopen(os.open(samples_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as samples:
            while True:
                elapsed = system.now() - started
                if owned_status() in ENDED:
                    summary["reason"] = "container-ended"
                    break
                if elapsed >= max_seconds or summary["samples"] >= MAX_LINES:
                    stop_owned("maximum-duration")
                    break
                try:
                    total, idle, memory, pressure = system.resources()
                    delta = total - previous[0] if previous else 0
                    cpu = max(0, min(100, 100 * (1 - (idle - previous[1]) / delta))) if delta > 0 else None
                    previous = total, idle
                except Exception:
                    stop_owned("host-resource-read-failed")
                    break
                health = None
                if future is not None and future.done():
                    if not health_timed_out:
                        try:
                            health = future.result()
                        except Exception:
                            health = {"status": None, "latencyMs": 0}
                    future = None
                elif future is not None and system.now() >= health_deadline:
                    # A blocked DNS lookup cannot bypass protection or create extra workers.
                    health = {"status": None, "latencyMs": 3000}
                    health_timed_out = True
                    health_deadline += 5
                if health is not None:
                    summary["healthChecks"] += 1
                    bad_health = bad_health + 1 if health["status"] != 200 else 0
                    slow_health = slow_health + 1 if health["latencyMs"] >= 1000 else 0
                    summary["maxHealthLatencyMs"] = max(summary["maxHealthLatencyMs"], health["latencyMs"])
                if future is None and system.now() >= next_health:
                    future = pool.submit(system.health, health_url)
                    next_health = system.now() + 5
                    health_deadline, health_timed_out = system.now() + 3, False
                low_memory = low_memory + 1 if memory < 500 else 0
                high_cpu = high_cpu + 1 if cpu is not None and cpu >= 95 else 0
                summary["minMemAvailableMiB"] = memory if summary["minMemAvailableMiB"] is None else min(memory, summary["minMemAvailableMiB"])
                summary["maxCpuPercent"] = max(summary["maxCpuPercent"], cpu or 0)
                samples.write(json.dumps({"elapsedSeconds": elapsed, "cpuPercent": cpu, "memAvailableMiB": memory,
                                          "pressure": pressure, "health": health}, separators=(",", ":")) + "\n")
                samples.flush()
                summary["samples"] += 1
                reason = "memory-pressure" if low_memory >= 2 else "host-cpu-saturated" if high_cpu >= 5 else "public-health-failed" if bad_health >= 2 else "public-health-slow" if slow_health >= 3 else None
                if reason:
                    stop_owned(reason)
                    break
                system.sleep(max(0, min(1, max_seconds - (system.now() - started))))
    except Refused as error:
        summary["reason"] = str(error)
        raise
    except (KeyboardInterrupt, Exception) as error:
        try:
            stop_owned("guard-interrupted" if isinstance(error, KeyboardInterrupt) else "guard-internal-error")
        except Refused as refusal:
            summary["reason"] = str(refusal)
            raise
    finally:
        summary["durationSeconds"] = system.now() - started
        with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as result:
            json.dump(summary, result, separators=(",", ":"))
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("container", "run-id", "output"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--max-seconds", type=int, required=True)
    parser.add_argument("--health-url", default=HEALTH_URL)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        print(json.dumps(monitor(args.container, args.run_id, args.output, args.max_seconds, args.health_url), separators=(",", ":")))
    except Refused as error:
        print("Load host guard refused: " + str(error))
        raise SystemExit(1)
