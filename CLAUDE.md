# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## What this is

`termexo-relay` is the relay service for [Termexo](https://github.com/gemron/Termexo), a
local-first desktop control plane for AI coding terminals. A desktop Termexo dials out to a relay
over a WebSocket tunnel; a phone or another computer then opens the full workbench at
`https://<relay>/d/<deviceId>/` without a public IP or a port forward. The relay is a single
cross-platform Rust binary (axum + rusqlite + rustls + yamux) with an Angular admin console
embedded at compile time.

The relay never terminates the workbench protocol. Each tunnel stream carries one plain HTTP/1.1
connection straight through to the desktop's own router, and since the `/ws` handshake is
end-to-end encrypted the relay cannot read the terminals it forwards — it decides whether a device
can be **reached**, never what may be **done** with it.

## Commands

```bash
cargo test                       # Unit tests plus the integration suites in tests/
cargo clippy --all-targets
cargo fmt

npm --prefix console install
npm --prefix console test -- --watch=false
npm --prefix console run build   # -> console/dist/relay-console/browser
```

`build.rs` embeds the console bundle through `include_dir!`. When the bundle is absent it falls
back to `console-placeholder/`, so `cargo test` never depends on the Node toolchain — only a
release build ships the real console.

Run one Rust test by name with `cargo test <substring>`; one console spec with
`npm --prefix console test -- --watch=false --include src/app/pages/devices-page.spec.ts`.

Building for a non-host target needs nothing beyond `rustup target add` and a C compiler — `cargo
build --release --target <triple>`. `aws-lc-rs` (rustls) and `rusqlite`'s bundled SQLite are the
only C in the tree; a non-FIPS `aws-lc-rs` needs no CMake, bindgen or Go. The musl targets also
need `musl-tools`, because `cc` would otherwise emit glibc objects:

```bash
sudo apt-get install -y musl-tools
CC_x86_64_unknown_linux_musl=musl-gcc cargo build --release --target x86_64-unknown-linux-musl
```

## The shared protocol crate

`termexo-relay-protocol` — control frames, the stream preface, device credentials, the failure
lockout table and the reconnect ladder — is **owned by the Termexo repository**, because the
desktop app compiles the same crate and builds entirely from its own checkout. `Cargo.toml`
declares it as a git dependency.

The revision is pinned, not a branch: a branch is deleted once it merges, a commit is not.

Copy `.cargo/config.toml.example` to `.cargo/config.toml` to build against a Termexo checkout
sitting next to this one, which is what makes it possible to change the protocol and compile both
sides without pushing and re-pinning in between. It is **not committed**: cargo fails outright when
a `paths` entry does not resolve, so a fresh clone, CI and the Docker build must not find one.

It uses `paths` rather than `[patch]` for a specific reason. A patch rewrites the crate's source in
`Cargo.lock` to a local path, so every local build silently un-pins the dependency; committing that
lock breaks `--locked` everywhere the override is absent — which is everywhere that matters. A path
override leaves the lock alone. `ci.yml` builds with `--locked` and no override, so a lock that ever
does get committed in the path form fails there rather than in someone's release.

**A protocol change touches two repositories.** Change the crate in Termexo, verify both sides
there and here, and keep the design note `docs/architecture/relay-service.md` (also in Termexo)
ahead of the code — it is the contract.

## Architecture

### Tunnels

A tunnel is one outbound WebSocket at `GET /tunnel`, authenticated before the upgrade with
`Authorization: Bearer tdc1.<deviceId>.<secret>`. Text frames are the control plane
(`hello` / `welcome` / `announce` / `ping` …); binary frames are concatenated into one byte stream
running yamux. The relay is `Mode::Client` — it is the only side that opens streams — and the
device is `Mode::Server`.

Every stream begins with a length-prefixed JSON preface naming the target device and the relays it
has passed through. An intermediate relay reads the preface, opens a stream to the next hop, and
copies bytes both ways: **no relay in the middle parses the HTTP it carries.**

### Cascading

A relay can enrol with another relay exactly as a desktop does, with `kind = relay`, and then
announces the devices it holds. The upstream routes to them through the downstream link
(`Route::Via`). Loops are refused in three places: the `welcome` chain, an announcement whose `via`
already names us, and a preface whose hops do.

Trust is one-directional. An upstream sees a downstream's devices and can drop the streams passing
through itself, but has no access to the downstream's users and cannot revoke its devices — those
belong to the relay that enrolled them.

### Access

`/d/<id>/` is reachable by anyone holding the link by default (`access = public`): the link carries
no secret, and the desktop's own token is the real gate. A device may instead require
`access = relay-login`, checked after the device record is found but before liveness, so a stranger
cannot even learn whether it is online.

`--subdomain-base` adds `<deviceId>.<base>` as a second entrance. The path form keeps working:
links already handed out must not break.

### Process lifecycle and the data directory

`serve` and `link` both go through `paths::prepare_data_directory`, which creates `<data-dir>`,
narrows it to its owner and returns the **absolute** path that is then logged and opened — the
default `--data-dir` is relative, and a service manager's working directory is rarely the one the
operator had in mind. `paths::restrict_to_owner` is the single place permissions are decided: it
strips every group and other bit and leaves the owner's alone, so it only ever tightens, is
idempotent (a mode that is already right is not rewritten) and is never fatal (a filesystem without
mode bits earns a `warn`, not a failed start). It covers the data directory, `tls/`, `tls/key.pem`
and `relay.db`; `cert.pem` is public and left alone, and the `-wal`/`-shm` sidecars are covered by
the directory. On Windows it is a no-op — files inherit the directory's ACL. The permission rule is
the pure `mode::tightened`, kept apart from the syscall so it is tested on every platform.

`shut_down_on` takes the wait as a parameter, so the wind-down is testable without raising a signal
at a process shared with every other test. On Unix `wait_for_stop_request` listens for SIGTERM *and*
SIGINT — `docker stop`, `systemctl stop` and a Kubernetes eviction all send SIGTERM — and the
wind-down closes the listener with a grace period and then stops the upstream link, so an upstream
stops routing into a process on its way out. Stopping the link keeps the stored credential; only
`upstream::disconnect` forgets it.

The `cfg(unix)` halves of both — the signal registration and the permission syscalls — cannot be
compiled on a Windows workstation. Linux CI is where they are first built and run, so keep that
surface thin and keep the decisions in cross-platform pure functions that the Windows suite covers.

### Persistence

`db/mod.rs` runs `migrations/` unconditionally on every start, so **migrations must be idempotent**
(`CREATE TABLE IF NOT EXISTS`, guarded `ensure_column`); there is no version table and no rollback.
The in-memory database used by tests goes through the same `migrate()` as the on-disk one — letting
them diverge would let a schema bug pass the suite.

## Conventions

- **Everything a user reads is Simplified Chinese** — API errors (`{"error": "…"}`), the offline
  page, tunnel close reasons, the console. Identifiers and comments stay English.
- Comments explain *why*. Don't restate the code.
- Secrets never reach a log, an audit `detail`, or an error message: not device credentials, not
  enrolment codes, not passwords, not session cookies, not certificate fingerprints.
- The console is Angular 22 standalone components with signals — no NgModules, no `*ngIf`/`*ngFor`,
  use `@if` / `@for`. Styling is Tailwind 4 + DaisyUI 5. Prettier: `printWidth: 100`, single quotes.
- Console requests go to relative `/api/...` with credentials; every non-GET carries
  `X-Requested-With: termexo-console`, which the server requires as its CSRF check.
- Follow the repository's code-quality rules: single responsibility, no magic values, no dead code
  left behind, short methods.

## Releasing

The version is duplicated in `Cargo.toml` and `console/package.json`, and tracks the Termexo
version it speaks to. `release.yml` refuses to build when the two disagree, or when a tag does not
match them. The tunnel protocol carries its own integer version, negotiated in `hello` and
independent of the release version — bump it only when the wire format changes.

Pushing a `v<version>` tag runs `.github/workflows/release.yml`: eight binaries, each on a runner of
its own architecture, published as `termexo-relay-<version>-<target>.tar.gz` (`.zip` on Windows)
with one `SHA256SUMS` beside them. `.github/workflows/docker.yml` builds `linux/amd64` and
`linux/arm64` on native runners, pushes each by digest, and joins them into one manifest list at
`ghcr.io/gemron/termexo-relay`. Nothing cross-compiles and nothing runs under QEMU: both C
dependencies would need a cross toolchain, and emulated compilation is slow enough to risk the job
timeout.

| Operating system | Architecture | Target |
| --- | --- | --- |
| Linux (glibc) | x86-64 / ARM64 | `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` |
| Linux (musl, static) | x86-64 / ARM64 | `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl` |
| macOS | Intel / Apple Silicon | `x86_64-apple-darwin`, `aarch64-apple-darwin` |
| Windows | x86-64 / ARM64 | `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` |

Two things the workflows depend on, neither of which holds yet:

- `termexo-relay-protocol` has to exist on Termexo's `main`, the branch `Cargo.toml` resolves it
  from. Until then every cargo step fails at dependency resolution.
- `Cargo.lock` has to record that crate from its **git** source. The committed lockfile records it
  as a path dependency, because `.cargo/config.toml` was in place when it was written, and every
  workflow deletes that file before running cargo (the image uses `.dockerignore` instead) since no
  runner has the sibling checkout. Regenerate and commit the lockfile without the patch once the
  crate is on `main`, or `--locked` rejects the changed resolution.
