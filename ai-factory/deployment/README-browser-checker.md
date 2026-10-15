# Isolated browser checks

The host checker is dedicated to the new Royal AI executor. It consumes fixed requests from `/opt/royal-ai-browser-queue`, mounted only into the trusted worker at `/browser-checks`. Model commands cannot access that directory. Docker remains a host service controlled by this checker.

The root-owned `/etc/royal-ai-browser-checker.json` contains exactly one field, `image_id`, with an immutable `sha256:` Docker image ID. Requests cannot select an image, command, environment, network, volume or host path. The only accepted source volume is `royal-ai_factory_workspaces`.

A request file is `<request_id>.request.json` with exactly these fields:

```json
{
  "request_id": "00000000-0000-4000-8000-000000000002",
  "task_id": "00000000-0000-4000-8000-000000000001",
  "candidate_commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "requirements_version": 1,
  "tests": ["tests/game-core.spec.ts"]
}
```

The checker accepts up to eight distinct ASCII names directly under `tests/`, ending in `.spec.ts`. Request files use mode 0644 inside the private root:1000 mode 2770 queue so the capability-free host service can read requests owned by UID 1000. The queue has no access for other users and is denied to model commands. Requests must be regular files with one link, at most 4096 bytes, and no more than 120 seconds old before execution. Workspaces, protected metadata directories and selected tests must have canonical paths. Symlink and traversal requests are rejected.

The response `<request_id>.response.json` echoes all request fields and records `status`, `passed`, `exit_code`, `detail`, `started_at` and `finished_at`. Status is `completed` for a measured test process, `error` for a setup or verification failure, `cancelled` for a revoked request, or `timeout` at the fixed 600-second limit. After publishing the response the host removes the consumed request and cancellation marker. The client consumes and removes the response.

The client creates `<request_id>.cancel` as an empty regular file when its lease is revoked. The host checks cancellation every half-second and destroys the named container before another request can use that workspace. Removing an active request also cancels it.

Every test container has its own PID namespace, protected default Docker `/proc`, no external network, no capabilities, no-new-privileges, a read-only image, temporary `/tmp`, UID/GID 1000, an init process, one CPU, 1536 MiB RAM and at most 256 processes. The singleton checker runs one container at a time. It mounts only the exact candidate workspace, root-owned trusted harness, and read-only overlays for `.git`, `.factory`, `.codex`, `.agents` and `.aws`. It receives no production or Codex credentials. Docker default AppArmor and seccomp remain enabled.

The trusted harness verifies the requested commit, clean Git status and a content fingerprint of tracked sources before and after checking. Git runs only inside this container with hooks, fsmonitor and global/system configuration disabled. It uses the bundled Chromium headless shell revision 1208 explicitly and confirms browser startup in a short-lived process. It builds with `NODE_ENV=production`, then starts the disposable PostgreSQL database and browser scenarios with `NODE_ENV=test`. Playwright uses the compiled backend at `http://127.0.0.1:2567`, serving the built frontend, API and multiplayer routes from one origin. This avoids development transforms and retained preflight libraries competing with Chromium for memory. Browser test Node processes have a 192 MiB heap bound; the preceding build has a 384 MiB heap bound. Each scenario has 90 seconds for software rendering on one CPU, while explicit assertion deadlines remain unchanged. The suite stops after its first failing scenario, with the remaining tests unverified. The exact Playwright early-stop notice is ignored only when the report contains an actual unexpected scenario; other global errors remain infrastructure errors. Test reports with no executed scenarios, setup errors or browser crashes become infrastructure errors. A bounded failure snapshot is included when available. The actual CLI exit code and measured assertions remain authoritative.

## Install after reviewing the helper

Preserve the existing executor source and image before rollout. Install the three new files into a dedicated root-owned directory, outside writable worker source:

```sh
install -d -o root -g root -m 0755 /opt/royal-ai-browser-checker
install -o root -g root -m 0644 deployment/browser-checker.py /opt/royal-ai-browser-checker/browser-checker.py
install -o root -g root -m 0644 deployment/browser-check.mjs /opt/royal-ai-browser-checker/browser-check.mjs
install -d -o root -g 1000 -m 2770 /opt/royal-ai-browser-queue
install -o root -g root -m 0644 deployment/browser-checker.service /etc/systemd/system/royal-ai-browser-checker.service
```

Write the inspected immutable worker image ID into `/etc/royal-ai-browser-checker.json` as `{ "image_id": "sha256:<64 lowercase hexadecimal characters>" }`, owned by root with mode 0600. The service refuses tags and rejects a writable configuration. Mount only `/opt/royal-ai-browser-queue` at `/browser-checks` in the worker, then enable the service after the probes pass:

```sh
python3 /opt/royal-ai-browser-checker/browser-checker.py --self-test
systemd-analyze verify /etc/systemd/system/royal-ai-browser-checker.service
systemctl daemon-reload
systemctl enable --now royal-ai-browser-checker.service
```

## Required probes

Run the built-in self-test for field restrictions, arbitrary-command rejection, traversal, symlink, hardlink, FIFO, oversized and stale requests, fixed Docker arguments, bounded Unicode output and safe response replacement. It does not start Docker or read project data.

Then use one real clean candidate commit to verify a relevant browser scenario through the queue. Confirm the response identifies exactly that candidate and that a test assertion failure has `status=completed`, `passed=false`, while a browser setup failure has `status=error`. Check `docker inspect` during execution for the expected isolation and absence of credential mounts. Verify candidate fingerprints and game container startup time after the probe.

Create a cancellation marker during a probe and confirm its container is removed, the response is `cancelled`, and the consumed request cannot run again after the response is deleted. After a stopped service restart, only containers with the exact checker label and UUID name are cleaned up. No release action is part of this checker.
