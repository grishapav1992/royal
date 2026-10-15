# Worker sandbox diagnostic

These files define a dedicated confined worker policy and repeatable disposable Linux probes. Do not enable task execution unless factory tests and all real isolation controls pass. Record the game baseline separately: a genuine failing game test blocks a candidate's release and becomes a development defect; it does not invalidate a successfully isolated executor. Persistent activation is a separate reviewed step through `enable-sandbox.sh`. There is no fallback to unsandboxed execution.

The tested host has Docker Engine 29.1.3 and AppArmor parser 4.0.1. The runtime image uses UID 1000 and bubblewrap 0.8.0. The candidate namespace rules currently target AMD64 only.

## Observed baseline

The initial baseline probes used a fresh `royal-ai-worker-runtime:0.1.0` container with `--rm`, `--network none`, `--security-opt no-new-privileges`, no volumes, no credentials, no model calls and no additional capabilities. Later filesystem and network probes use a disposable container with ordinary bridge networking and dummy fixtures. Game checks mount only the new worker's isolated workspace volume and use `--network none`.

| Outer policy | Result |
| --- | --- |
| Docker defaults | `bwrap: No permissions to create new namespace` |
| Only seccomp unconfined | `bwrap: Failed to make / slave: Permission denied` |
| Seccomp and AppArmor unconfined | `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` |

Host settings stayed unchanged: `kernel.unprivileged_userns_clone=1`, `kernel.apparmor_restrict_unprivileged_userns=1`, `user.max_user_namespaces=11738`. The kernel audit log confirmed that an unconfined process transitions into `unprivileged_userns`, which denies `setpcap` and `net_admin` in the child namespace. The initial process had no effective, permitted or ambient capabilities, and `NoNewPrivs=1`.

A request to load an initial profile with `flags=(unconfined)` was rejected by automatic approval review. That profile was never loaded. The replacement AppArmor file uses confinement and retains the Docker system-path and same-profile ptrace restrictions. Its syntax and real sandbox operation were checked in disposable containers. All 28 filesystem and network cases passed, with successful positive controls. Each transient profile was removed after its probe.

## Pinned primary sources

- [Docker seccomp documentation](https://docs.docker.com/engine/security/seccomp/).
- [Moby Docker 29.1.3 commit](https://github.com/moby/moby/commit/fbf3ed25f893e6ce21336f1101590e40a13934f4), tag `docker-v29.1.3`.
- [Vendored seccomp default.json](https://raw.githubusercontent.com/moby/moby/fbf3ed25f893e6ce21336f1101590e40a13934f4/vendor/github.com/moby/profiles/seccomp/default.json), dependency `github.com/moby/profiles/seccomp v0.1.0`, source SHA256 `01536f1d1df938ae611eba20d6349e0de7a99b6ecdee1549427a0b01b8301e28`.
- [Vendored Docker AppArmor template](https://raw.githubusercontent.com/moby/moby/fbf3ed25f893e6ce21336f1101590e40a13934f4/vendor/github.com/moby/profiles/apparmor/template.go), source SHA256 `03b143f6a251223c95a5943fd17849c27d7484414e745b0411649b87c19f8c7d`.
- [Bubblewrap 0.8.0 namespace and root setup](https://github.com/containers/bubblewrap/blob/v0.8.0/bubblewrap.c), [raw clone helper](https://github.com/containers/bubblewrap/blob/v0.8.0/utils.c), [bind mounts](https://github.com/containers/bubblewrap/blob/v0.8.0/bind-mount.c).
- [Ubuntu 24.04 user namespace restrictions](https://documentation.ubuntu.com/release-notes/24.04/), [AppArmor mount and pivot rules](https://manpages.ubuntu.com/manpages/noble/man5/apparmor.d.5.html).
- [Codex permission profiles](https://learn.chatgpt.com/docs/permissions). The installed CLI uses `codex sandbox -P NAME -C WORKSPACE -- COMMAND`; `-C` requires `-P` for this subcommand. `exec` selects the profile through `-c default_permissions`.

The upstream files are from the Moby project under Apache-2.0. Their original policy is retained, with only the candidate additions described below.

## Candidate changes

An initial confined transient probe was approved and run, but namespace creation still failed. Cleanup was confirmed. There were no AppArmor DENIED events for that probe. A diagnostic image with strace then measured the actual system `/usr/bin/bwrap` calls for the built-in workspace profile and all three real adapter role profiles, including the network proxy enabled for developer and tester. Every observed namespace clone used the same flags and null child stack. The earlier three guessed clone variants have been removed.

`worker-seccomp.json` retains the pinned Docker default allowlist, default `SCMP_ACT_ERRNO`, the `clone3=ENOSYS` fallback and existing capability gates. It adds four rules:

| Syscall | Allowed arguments | Reason |
| --- | --- | --- |
| `clone` | AMD64 flags exactly 2013397009 (`0x78020011`); child stack null | Observed user/mount/IPC/PID/network namespace creation |
| `unshare` | Flags exactly 268435456 | Bubblewrap nested user namespace |
| `umount2` | Flags exactly 2 | Detach the old root |
| `mount`, `pivot_root` | Paired with the confined AppArmor policy | Build and activate the isolated root |

The clone rule and staging-root setup are measured, not guessed. `setns`, broader namespace flags, `clone3`, `bpf` and other privileged syscalls are not opened. Ordinary seccomp cannot dereference mount-path arguments or prove that a syscall comes from a child user namespace. AppArmor scopes mount destinations to the observed staging roots and root-propagation operations. The `/newroot/**` option-set rule permits combinations of its listed flags without restricting filesystem type; it is not a bind-only rule. Outer UID, dropped kernel capabilities, no-new-privileges and the inner Codex permission profile remain separate controls.

`worker-apparmor` replaces the Docker blanket `deny mount` with candidate bubblewrap mount and pivot rules, adds `userns`, and keeps the `/proc`, `/sys`, kernel-security-path and same-profile ptrace restrictions. AppArmor `capability` rules permit checks inside a namespace; they do not grant capabilities to the outer worker process.

## Reviewable transient probe

Review `probe-sandbox.sh` before executing it. It loads only the new `royal-ai-worker-test` profile, refuses to replace an existing profile, attaches it only to one named disposable container, and removes the container and kernel profile in an EXIT/INT/TERM cleanup path. It does not install any file in `/etc/apparmor.d`, change sysctls, restart services or mount project data.

After approval, run on the Docker host from the uploaded project:

```sh
bash deployment/probe-sandbox.sh
```

The container runs as `1000:1000` with all outer capabilities dropped, `no-new-privileges`, the candidate seccomp policy and the confined test AppArmor profile. The first command is `/bin/true` inside the real Codex sandbox. Then `sandbox-probe.mjs` uses the actual adapter's `permissionArgs` without invoking its runner, login methods or any model.

The negative checks use newly created dummy fixtures inside the disposable container. For each role, they verify blocked authentication-directory reads, unrelated-home reads and writes, and `.git` writes. Positive controls verify runtime reads and temporary writes. Analyst workspace writes must fail; developer and tester workspace writes must succeed. Any failed positive control makes the diagnostic fail, preventing a broken sandbox from counting as successful isolation. The trusted `codex-linux-sandbox` helper alias lives in `/usr/local/bin`; the authentication directory and its temporary helper cache remain unreadable by role commands.

The bridge-network probe confirms that the outer container can reach an ordinary HTTPS page (HTTP 200), while developer and tester commands receive the expected domain-denial response (HTTP 403). Direct external TCP connections with proxy variables removed fail with `ENETUNREACH`. Localhost HTTP works for developer and tester and is blocked for the analyst. No production service, model or authentication cache participates in these checks. The outer controller separately needs access to OpenAI for subscription login and model requests.

`probe-dependencies.sh` checks the controller-only dependency profile. It permits `registry.npmjs.org` and blocks unrelated domains and direct external TCP. `allow_local_binding=false` controls the proxy's access to local/private destinations; it does not prohibit binding a loopback server inside the private network namespace. `npm ci --ignore-scripts` resets dependencies before QA. Package installation does not run lifecycle scripts.

`probe-checks.sh` verifies the actual game build and server tests against a private PostgreSQL database. The worker limit is 1024 MiB and Node builds use a 384 MiB heap. The actual build passed at this limit; 768 MiB caused a measured out-of-memory kill. Four fixed bundled PostgreSQL library symlinks are restored after script-free installation. `LD_LIBRARY_PATH` is supplied inside the sandbox command only. The trusted `.factory/database-test.mjs` harness disables Unix sockets, uses a random private TCP port and preserves the real test exit status despite the embedded library's exit hook. Managed fixtures are protected against symlink, hardlink and FIFO replacement.

The fixed controller checks use a separate system bubblewrap executor, not a model command. Codex 0.162.0's proxy-restricted Linux seccomp blocks creation of AF_UNIX servers even when exact paths are present in `network.unix_sockets`. The broad Unix-socket option is not enabled. Fixed checks instead receive an empty root with read-only runtime, exactly one writable workspace, read-only canonical metadata directories, a private tmpfs `/tmp`, minimal devices and private user/mount/IPC/PID/network namespaces. Only their private loopback network is available. `/proc` is an empty directory: mounting a fresh proc filesystem is rejected by Docker's existing masked-path protections, which remain intact. No host `/proc`, authentication, secrets, sibling workspace or Docker socket is mounted. The environment is cleared, capabilities are dropped and parent death terminates the namespace. All 19 positive and negative controls passed in a disposable bridge-network container with an external HTTP 200 positive control. No outer AppArmor or seccomp additions were required for this executor.

AppleDouble files beginning with `._` are excluded from new snapshots and hidden files are excluded from the mandatory test selector. Tests and assertions are not rewritten or skipped to accommodate Unix sockets.

After the probe, confirm cleanup:

```sh
grep '^royal-ai-worker-test ' /sys/kernel/security/apparmor/profiles
docker ps -a --filter name=royal-ai-sandbox-probe-
```

Expected: no test profile and no probe container. If cleanup fails or the shell is terminated with SIGKILL, remove only the diagnostic container and `royal-ai-worker-test` profile, then stop. Do not enable execution or install a persistent policy until review and all required positive and negative isolation checks pass.
