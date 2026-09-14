# termexo-relay

**English** | [简体中文](README.cn.md)

The relay service for [Termexo](https://github.com/gemron/Termexo). A desktop Termexo opens an
outbound tunnel to the relay, and a phone or another computer can then open that machine's full
Termexo workbench at `https://<relay>/d/<deviceId>/` — no public IP address and no port forwarding
on the router.

The tunnel protocol, the stream preface and the device credential format live in the shared crate
`termexo-relay-protocol`. It belongs to the [Termexo](https://github.com/gemron/Termexo) repository —
the desktop app compiles the same crate — and this repository pulls it in as a git dependency. The
design note, [`docs/architecture/relay-service.md`](https://github.com/gemron/Termexo/blob/main/docs/architecture/relay-service.md),
lives there too.

> The admin console follows the browser's language and is available in English and Simplified
> Chinese. Messages produced by the server itself — API errors, the offline and access-denied pages,
> log lines and the one-time password banner — are in Simplified Chinese.

## Contents

- [How it works](#how-it-works)
- [Install](#install)
- [Quick start: a relay on your LAN in one minute](#quick-start-a-relay-on-your-lan-in-one-minute)
- [Command reference](#command-reference)
  - [`serve`](#serve)
  - [`link`](#link)
  - [`admin reset-password`](#admin-reset-password)
- [Deployment scenarios](#deployment-scenarios)
- [Operating the relay](#operating-the-relay)
- [Data directory and permissions](#data-directory-and-permissions)
- [Stopping](#stopping)
- [Development](#development)
- [Known limitations](#known-limitations)

## How it works

```
 phone / laptop browser                relay                      desktop Termexo
 ─────────────────────   https   ─────────────────   outbound   ─────────────────
 https://relay/d/<id>/  ───────▶  termexo-relay   ◀─────────────  /tunnel (WebSocket)
                                  forwards bytes   yamux streams
```

- The desktop dials **out** to `GET /tunnel` and keeps the connection open, so it works behind NAT
  and firewalls.
- Every browser request for `/d/<deviceId>/` travels down that tunnel to the desktop's own web
  server. The relay decides whether a device can be **reached**; what may be **done** there is still
  decided by the desktop's access token.
- Terminal traffic (`/ws`) is end-to-end encrypted with AES-256-GCM, using keys derived from the
  desktop's access token, which never reaches the relay. The relay sees when devices are online,
  which addresses connect, and the timing and size of traffic — not terminal output, commands or the
  token. The workbench's static files pass in clear; they are public application code.

## Install

### Prebuilt archives

Every `v*` tag builds the targets below on runners of their own architecture and publishes them to
[Releases](https://github.com/gemron/termexo-relay/releases) together with a `SHA256SUMS` file. Each
archive holds the executable and this README; there is no other runtime dependency.

| Operating system | Architecture | Archive | Target triple |
| --- | --- | --- | --- |
| Linux (glibc) | x86-64 | `.tar.gz` | `x86_64-unknown-linux-gnu` |
| Linux (glibc) | ARM64 | `.tar.gz` | `aarch64-unknown-linux-gnu` |
| Linux (musl, static) | x86-64 | `.tar.gz` | `x86_64-unknown-linux-musl` |
| Linux (musl, static) | ARM64 | `.tar.gz` | `aarch64-unknown-linux-musl` |
| macOS | Intel | `.tar.gz` | `x86_64-apple-darwin` |
| macOS | Apple Silicon | `.tar.gz` | `aarch64-apple-darwin` |
| Windows | x86-64 | `.zip` | `x86_64-pc-windows-msvc` |
| Windows | ARM64 | `.zip` | `aarch64-pc-windows-msvc` |

Download, verify and install on Linux x86-64:

```bash
VERSION=0.10.2
TARGET=x86_64-unknown-linux-gnu
curl -LO "https://github.com/gemron/termexo-relay/releases/download/v${VERSION}/termexo-relay-${VERSION}-${TARGET}.tar.gz"
curl -LO "https://github.com/gemron/termexo-relay/releases/download/v${VERSION}/SHA256SUMS"
sha256sum -c SHA256SUMS --ignore-missing
tar -xzf "termexo-relay-${VERSION}-${TARGET}.tar.gz"
sudo install -m 0755 "termexo-relay-${VERSION}-${TARGET}/termexo-relay" /usr/local/bin/
termexo-relay --version
```

The two musl builds are statically linked and do not depend on the distribution's glibc; use them
on old systems and on Alpine. Everything else on Linux can use the glibc builds.

Platforms outside the table (FreeBSD, 32-bit ARM, Linux riscv64 and so on) have **no prebuilt
binaries**, but the source has no platform-specific branches, so building it yourself usually works.

### Container image

The image is published to GitHub Container Registry as one manifest list covering `linux/amd64` and
`linux/arm64`; Docker pulls the one that matches the host.

```bash
docker pull ghcr.io/gemron/termexo-relay:0.10.2
```

| Tag | Points at |
| --- | --- |
| `0.10.2` | That exact release |
| `0.10` | The newest release of the 0.10 line |
| `latest` | The newest release tag |
| `main` | The newest commit on `main`, for trying things out; not for production |

The image is based on `debian:bookworm-slim`; SQLite is compiled into the binary and only CA
certificates are added at runtime. It sets `TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay` (declared
as a volume) and `TERMEXO_RELAY_LISTEN=0.0.0.0:8443`, and its default command is `serve`. There is
no separate musl/Alpine image — the static binaries are already on the Releases page.

See [Docker](#docker) and [Docker Compose with Caddy](#docker-compose-with-caddy) for complete
examples.

### Build from source

You need two things:

- a **Rust toolchain** no older than `rust-version` in `Cargo.toml` (currently 1.88);
- a **C/C++ compiler** — `aws-lc-rs` (TLS) and `rusqlite`'s bundled SQLite both compile C.

A non-FIPS build does **not** need CMake, bindgen or Go: `aws-lc-rs` ships pre-generated bindings,
and Windows x86-64 has a prebuilt NASM object as a fallback.

| Platform | Install |
| --- | --- |
| Linux | `build-essential` (gcc); the musl targets also need `musl-tools`, which provides `musl-gcc` |
| macOS | Xcode command line tools (`xcode-select --install`) |
| Windows | Visual Studio 2022 Build Tools with the "Desktop development with C++" workload (MSVC) |

```bash
cargo build --release                      # -> target/release/termexo-relay

# A static Linux binary:
sudo apt-get install -y musl-tools
rustup target add x86_64-unknown-linux-musl
CC_x86_64_unknown_linux_musl=musl-gcc cargo build --release --target x86_64-unknown-linux-musl
```

A binary built this way embeds the console **placeholder page**. To embed the real console, build
the front end first (this needs Node):

```bash
npm --prefix console install
npm --prefix console run build             # -> console/dist/relay-console/browser
cargo build --release
```

## Quick start: a relay on your LAN in one minute

Suppose the relay machine is `192.168.1.20` on your home network and you have no domain name.

1. Start the relay with a self-signed certificate (the default TLS mode):

   ```bash
   termexo-relay serve \
     --data-dir ./relay-data \
     --public-url https://192.168.1.20:8443
   ```

2. Copy two things from the output. The password is printed **only on this first start**; the
   fingerprint is logged on every start:

   ```
   ────────────────────────────────────────────
   控制台账号：admin
   一次性密码：K7QD3MTR9WXF2HJN
   请立即登录 /console/ 并修改密码，这条信息只显示一次。
   ────────────────────────────────────────────
   INFO termexo_relay::tls: 自签名证书指纹（SHA-256） fingerprint=45:7C:B9:97:…:1E
   INFO termexo_relay::server: Termexo 中继已启动 listen=0.0.0.0:8443 public_url=https://192.168.1.20:8443 …
   ```

   `控制台账号` is the console username and `一次性密码` the one-time password. The
   `自签名证书指纹（SHA-256）` line carries the certificate fingerprint.

3. Open `https://192.168.1.20:8443/console/`, accept the certificate warning, sign in as `admin` and
   change the password.
4. Go to **Enrolment codes** and issue a `desktop` code, for example `ABCD-EFGH-JKLM`.
5. On the desktop, open Termexo **Settings → Remote access → Access through a relay** and fill in:
   - **Relay address**: `https://192.168.1.20:8443`
   - **Certificate fingerprint (SHA-256)**: the fingerprint from step 2
   - **How to join**: *Enrolment code*, then paste `ABCD-EFGH-JKLM` and click **Join**
6. The panel now shows the device address, such as `https://192.168.1.20:8443/d/<deviceId>/`. Open
   it on your phone.

## Command reference

```
termexo-relay serve                  Start the relay service
termexo-relay link                   Join an upstream relay with an enrolment code (writes config only)
termexo-relay admin reset-password   Reset a console account's password
termexo-relay --help | --version
```

`termexo-relay <command> --help` lists the options of one command.

### `serve`

Starts the relay: the tunnel endpoint, the public reverse proxy, the API and the console.

| Option | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `--data-dir <path>` | `TERMEXO_RELAY_DATA_DIR` | `relay-data` | Where the SQLite database and the self-signed certificate live |
| `--listen <addr:port>` | `TERMEXO_RELAY_LISTEN` | `0.0.0.0:8443` | The socket address to listen on |
| `--public-url <url>` | `TERMEXO_RELAY_PUBLIC_URL` | derived from `--listen` | The address browsers use to reach the relay |
| `--tls <mode>` | `TERMEXO_RELAY_TLS` | `self-signed` | `self-signed`, `cert:<chain>,<key>` or `off` |
| `--trusted-proxy <cidr>` | `TERMEXO_RELAY_TRUSTED_PROXY` | none | Reverse proxy networks whose forwarding headers are trusted; only with `--tls off` |
| `--subdomain-base <host>` | `TERMEXO_RELAY_SUBDOMAIN_BASE` | none | Enables `<deviceId>.<host>` device addresses |

A command-line option wins over its environment variable.

#### `--data-dir`

The directory holding `relay.db` (users, devices, enrolment codes, sessions, audit log, upstream
link) and, in self-signed mode, `tls/cert.pem` and `tls/key.pem`. It is created if missing and its
permissions are tightened on every start (see [Data directory and permissions](#data-directory-and-permissions)).

```bash
# A fixed location for a service
termexo-relay serve --data-dir /var/lib/termexo-relay

# The same through the environment
TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay termexo-relay serve

# Windows, for development
termexo-relay.exe serve --data-dir "C:\termexo-relay\data"
```

The default `relay-data` is **relative** to the working directory. The start-up log prints the
absolute path actually used:

```
INFO termexo_relay::server: 中继数据目录 data_dir=/var/lib/termexo-relay
```

#### `--listen`

```bash
# Every IPv4 interface on port 8443 (the default)
termexo-relay serve --listen 0.0.0.0:8443

# Loopback only — the relay sits behind Caddy or nginx on the same machine
termexo-relay serve --listen 127.0.0.1:8443 --tls off

# Another port
termexo-relay serve --listen 0.0.0.0:9443

# IPv6
termexo-relay serve --listen '[::]:8443'
```

Ports below 1024 need extra privileges; the default 8443 avoids that, so the container needs no
added capabilities.

#### `--public-url`

The origin browsers see: scheme, host and an optional port, **no path, query or fragment**. The relay
builds every address it hands out from it — the device addresses shown in the console and in the
desktop panel, and the addresses announced to an upstream relay — and it decides whether the
session cookie gets `Secure`.

```bash
# A domain name served on 443 by a reverse proxy
termexo-relay serve --public-url https://relay.example.com

# A LAN address with a port
termexo-relay serve --public-url https://192.168.1.20:8443

# A trailing slash is accepted and dropped
termexo-relay serve --public-url https://relay.example.com/
```

Refused values and why:

| Value | Error |
| --- | --- |
| `relay.example.com` | Must start with `http://` or `https://` |
| `https://relay.example.com/console` | Paths are not allowed |
| `https://` | The host is missing |

Without `--public-url` the relay derives one from `--listen`: `0.0.0.0:8443` with TLS becomes
`https://localhost:8443`, which no other machine can open — **set it on every real deployment.**

#### `--tls`

| Mode | Use it when |
| --- | --- |
| `self-signed` | You have no domain name (LAN, VPN, a bare IP). Desktops pin the certificate by fingerprint |
| `cert:<chain>,<key>` | You already have a certificate and want the relay to terminate TLS itself |
| `off` | The relay sits behind Caddy, nginx or another proxy that terminates TLS |

```bash
# Self-signed (default): generated on first start into <data-dir>/tls/ and reused afterwards
termexo-relay serve --tls self-signed --public-url https://192.168.1.20:8443

# Your own PEM chain and private key, separated by a comma
termexo-relay serve \
  --tls cert:/etc/letsencrypt/live/relay.example.com/fullchain.pem,/etc/letsencrypt/live/relay.example.com/privkey.pem \
  --public-url https://relay.example.com:8443

# Plain HTTP behind a reverse proxy
termexo-relay serve --tls off --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com --trusted-proxy 127.0.0.1/32
```

In self-signed mode the log prints the certificate's SHA-256 fingerprint on every start. You can also
read it from the file:

```bash
openssl x509 -in /var/lib/termexo-relay/tls/cert.pem -noout -fingerprint -sha256
```

The certificate's subject names come from `--public-url` (and `--subdomain-base`, when set). A
certificate that already exists is **not regenerated** when those change: stop the relay, delete
`<data-dir>/tls/` and start it again, then re-enter the new fingerprint on the desktops.

`cert:` needs both paths; `cert:/etc/full.pem` without the key is refused. The relay has **no
built-in ACME** (automatic Let's Encrypt); use a reverse proxy for that.

#### `--trusted-proxy`

Only read with `--tls off`. Connections from these networks may set `X-Forwarded-For`,
`X-Forwarded-Proto` and `X-Forwarded-Host`; everything else is taken from the socket. Without it,
every browser behind your proxy looks like the proxy's own address, and one person's failed logins
lock everybody out.

Values are **CIDR networks** — write `127.0.0.1/32`, not `127.0.0.1`.

```bash
# The proxy runs on the same machine
termexo-relay serve --tls off --trusted-proxy 127.0.0.1/32

# Repeat the option for several networks...
termexo-relay serve --tls off --trusted-proxy 10.0.0.0/8 --trusted-proxy 172.16.0.0/12

# ...or separate them with commas, which is also how the environment variable takes a list
TERMEXO_RELAY_TRUSTED_PROXY=10.0.0.0/8,172.16.0.0/12 termexo-relay serve --tls off

# IPv6 loopback
termexo-relay serve --tls off --trusted-proxy ::1/128
```

In Docker, trust the bridge network the proxy container talks from, for example `172.16.0.0/12`.

#### `--subdomain-base`

A bare host name (no scheme, port or path) under which every device also gets its own subdomain.

```bash
termexo-relay serve --tls off --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com \
  --trusted-proxy 127.0.0.1/32 \
  --subdomain-base relay.example.com
```

With that, a device answers at both:

```
https://<deviceId>.relay.example.com/        # subdomain form
https://relay.example.com/d/<deviceId>/      # path form, always available
```

The value is lowercased and trailing dots are dropped (`Relay.Example.COM.` becomes
`relay.example.com`). `https://relay.example.com`, `relay.example.com:8443`, `localhost` and
`-bad.example.com` are refused. See [Subdomain addresses](#subdomain-addresses) for DNS and
certificates.

#### Configuring `serve` only through the environment

```bash
export TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay
export TERMEXO_RELAY_LISTEN=127.0.0.1:8443
export TERMEXO_RELAY_PUBLIC_URL=https://relay.example.com
export TERMEXO_RELAY_TLS=off
export TERMEXO_RELAY_TRUSTED_PROXY=127.0.0.1/32
export TERMEXO_RELAY_SUBDOMAIN_BASE=relay.example.com
termexo-relay serve
```

#### Log level

Logs go to standard output at `info` by default. `RUST_LOG` takes a
[tracing filter](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html):

```bash
# Everything at debug
RUST_LOG=debug termexo-relay serve

# Only warnings and errors
RUST_LOG=warn termexo-relay serve

# debug for the relay's own tunnel code, info for everything else
RUST_LOG=info,termexo_relay::tunnel=debug termexo-relay serve
```

### `link`

Joins this relay to an **upstream** relay with an enrolment code of kind `relay` that the upstream
issued. It stores the credential in the data directory and exits; the next `serve` connects and keeps
the link up. Devices held by this relay then become reachable through the upstream as well.

| Option | Environment variable | Required | Meaning |
| --- | --- | --- | --- |
| `--data-dir <path>` | `TERMEXO_RELAY_DATA_DIR` | no (`relay-data`) | The data directory of **this** relay |
| `--upstream <url>` | — | yes | The upstream relay's public address |
| `--code <code>` | — | yes | A `relay` enrolment code issued by the upstream |
| `--name <name>` | — | no | How this relay is listed on the upstream; defaults to the host of this relay's saved public address |
| `--certificate-fingerprint <sha256>` | — | only for a self-signed upstream | The upstream certificate's SHA-256 fingerprint |

```bash
# Upstream with a trusted certificate (for example behind Caddy)
termexo-relay link --data-dir /var/lib/termexo-relay \
  --upstream https://relay-a.example.com \
  --code ABCD-EFGH-JKLM

# Give this relay a readable name on the upstream
termexo-relay link --data-dir /var/lib/termexo-relay \
  --upstream https://relay-a.example.com \
  --code ABCD-EFGH-JKLM \
  --name office-relay

# Upstream with a self-signed certificate: pin its fingerprint
termexo-relay link --data-dir /var/lib/termexo-relay \
  --upstream https://203.0.113.10:8443 \
  --code ABCD-EFGH-JKLM \
  --certificate-fingerprint 45:7C:B9:97:…:1E
```

The fingerprint may be written with or without colons and in either case; it is stored lowercase
without colons. Leave it out when the upstream has a trusted certificate. Without `--name`, the
relay uses the host of the public address it saved the last time `serve` ran, or a generic name if it
has never run — pass `--name` to be sure what the upstream shows. The chosen name is printed.

### `admin reset-password`

Resets a console account's password, prints the new one-time password and signs that account out
everywhere. It reads and writes the data directory directly, so the relay may keep running.

| Option | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `--data-dir <path>` | `TERMEXO_RELAY_DATA_DIR` | `relay-data` | The relay's data directory |
| `--username <name>` | — | `admin` | The account to reset |

```bash
# The first administrator
termexo-relay admin reset-password --data-dir /var/lib/termexo-relay

# Another account
termexo-relay admin reset-password --data-dir /var/lib/termexo-relay --username alice

# Inside the container
docker exec -it termexo-relay termexo-relay admin reset-password
```

## Deployment scenarios

### LAN or VPN relay without a domain name

Self-signed TLS, desktops pin the fingerprint. Good for a home server, a NAS or a VPN such as
Tailscale or WireGuard.

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --listen 0.0.0.0:8443 \
  --public-url https://192.168.1.20:8443
```

On a VPN, use the VPN address in `--public-url`, for example `https://100.64.0.5:8443`. Browsers warn
about the certificate once per device; the desktop app does not, because it pins the fingerprint.

### Public relay behind Caddy (recommended)

Caddy obtains and renews the certificate; the relay speaks plain HTTP on loopback.

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8443
}
```

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --tls off \
  --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com \
  --trusted-proxy 127.0.0.1/32
```

- `--public-url` must be the address the browser sees, not `http://127.0.0.1:8443`.
- `--trusted-proxy` must cover Caddy's source address, or login lockouts hit everyone at once.
- Caddy forwards WebSocket upgrades and the `X-Forwarded-*` headers by default; nothing else is needed.
- Desktops leave **Certificate fingerprint** empty, because the certificate is publicly trusted.

### Public relay behind nginx

```nginx
server {
    listen 80;
    server_name relay.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8443;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # Device tunnels and terminal sessions stay open for a long time.
        proxy_read_timeout 1h;
    }
}
```

The relay runs with the same options as in the Caddy example.

### Public relay behind Traefik

Traefik (v3) forwards WebSocket upgrades, keeps the `Host` header and sets the `X-Forwarded-*` headers
by default, so only routing and the certificate need configuring.

**With Docker labels** — Traefik discovers the relay container and obtains a Let's Encrypt
certificate with the TLS-ALPN challenge:

```yaml
# compose.yaml
services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.email=you@example.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.le.acme.tlschallenge=true
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-certs:/letsencrypt

  relay:
    image: ghcr.io/gemron/termexo-relay:0.10.2
    restart: unless-stopped
    environment:
      TERMEXO_RELAY_TLS: "off"
      TERMEXO_RELAY_PUBLIC_URL: https://relay.example.com
      # The Compose network Traefik connects from.
      TERMEXO_RELAY_TRUSTED_PROXY: 172.16.0.0/12
    volumes:
      - relay-data:/var/lib/termexo-relay
    labels:
      - traefik.enable=true
      - traefik.http.routers.relay.rule=Host(`relay.example.com`)
      - traefik.http.routers.relay.entrypoints=websecure
      - traefik.http.routers.relay.tls.certresolver=le
      - traefik.http.services.relay.loadbalancer.server.port=8443

volumes:
  relay-data:
  traefik-certs:
```

Docker usually hands Compose networks addresses from `172.16.0.0/12`; if yours come from another pool
(`docker network inspect <project>_default` shows it), trust that range instead.

**With a relay binary and Traefik's file provider** — the relay listens on loopback, as in the Caddy
example:

```yaml
# /etc/traefik/traefik.yml (static configuration)
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

certificatesResolvers:
  le:
    acme:
      email: you@example.com
      storage: /var/lib/traefik/acme.json
      tlsChallenge: {}

providers:
  file:
    filename: /etc/traefik/dynamic.yml
```

```yaml
# /etc/traefik/dynamic.yml
http:
  routers:
    relay:
      rule: Host(`relay.example.com`)
      entryPoints:
        - websecure
      service: relay
      tls:
        certResolver: le
  services:
    relay:
      loadBalancer:
        servers:
          - url: http://127.0.0.1:8443
```

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --tls off \
  --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com \
  --trusted-proxy 127.0.0.1/32
```

**With subdomain addresses** — a wildcard certificate needs the DNS-01 challenge. For Cloudflare, give
Traefik a `CF_DNS_API_TOKEN` environment variable, swap the TLS challenge for the DNS one and route the
base host and its subdomains to the relay:

```yaml
  traefik:
    environment:
      CF_DNS_API_TOKEN: ${CF_DNS_API_TOKEN}
    command:
      # ...the same entry points as above, with this resolver instead of tlschallenge:
      - --certificatesresolvers.le.acme.email=you@example.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.le.acme.dnschallenge.provider=cloudflare

  relay:
    environment:
      TERMEXO_RELAY_TLS: "off"
      TERMEXO_RELAY_PUBLIC_URL: https://relay.example.com
      TERMEXO_RELAY_TRUSTED_PROXY: 172.16.0.0/12
      TERMEXO_RELAY_SUBDOMAIN_BASE: relay.example.com
    labels:
      - traefik.enable=true
      - traefik.http.routers.relay.rule=Host(`relay.example.com`) || HostRegexp(`^[^.]+\.relay\.example\.com$`)
      - traefik.http.routers.relay.entrypoints=websecure
      - traefik.http.routers.relay.tls.certresolver=le
      - traefik.http.routers.relay.tls.domains[0].main=relay.example.com
      - traefik.http.routers.relay.tls.domains[0].sans=*.relay.example.com
      - traefik.http.services.relay.loadbalancer.server.port=8443
```

The DNS still needs the wildcard record described in [Subdomain addresses](#subdomain-addresses).

### Terminating TLS in the relay with your own certificate

No proxy; the relay loads the certificate itself. Remember that the relay does not reload a renewed
certificate — restart it after renewal.

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --listen 0.0.0.0:8443 \
  --public-url https://relay.example.com:8443 \
  --tls cert:/etc/termexo/fullchain.pem,/etc/termexo/privkey.pem
```

### Docker

```bash
docker run -d --name termexo-relay \
  --restart unless-stopped \
  -p 8443:8443 \
  -v termexo-relay-data:/var/lib/termexo-relay \
  -e TERMEXO_RELAY_PUBLIC_URL=https://192.168.1.20:8443 \
  ghcr.io/gemron/termexo-relay:0.10.2

docker logs termexo-relay          # the one-time admin password and the certificate fingerprint
```

Options can also be passed as arguments after the image name, since the entry point is the binary:

```bash
docker run -d --name termexo-relay -p 8443:8443 \
  -v termexo-relay-data:/var/lib/termexo-relay \
  ghcr.io/gemron/termexo-relay:0.10.2 \
  serve --public-url https://192.168.1.20:8443
```

Using your own certificate from the host:

```bash
docker run -d --name termexo-relay -p 8443:8443 \
  -v termexo-relay-data:/var/lib/termexo-relay \
  -v /etc/termexo:/etc/termexo:ro \
  -e TERMEXO_RELAY_PUBLIC_URL=https://relay.example.com:8443 \
  -e TERMEXO_RELAY_TLS=cert:/etc/termexo/fullchain.pem,/etc/termexo/privkey.pem \
  ghcr.io/gemron/termexo-relay:0.10.2
```

`docker stop` delivers SIGTERM straight to the relay (it is PID 1), which closes the tunnels and exits
well within Docker's 10-second grace period.

### Docker Compose with Caddy

```yaml
# compose.yaml
services:
  relay:
    image: ghcr.io/gemron/termexo-relay:0.10.2
    restart: unless-stopped
    environment:
      TERMEXO_RELAY_TLS: "off"
      TERMEXO_RELAY_PUBLIC_URL: https://relay.example.com
      # The Compose network Caddy connects from.
      TERMEXO_RELAY_TRUSTED_PROXY: 172.16.0.0/12
    volumes:
      - relay-data:/var/lib/termexo-relay

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data

volumes:
  relay-data:
  caddy-data:
```

```caddyfile
# Caddyfile
relay.example.com {
    reverse_proxy relay:8443
}
```

```bash
docker compose up -d
docker compose logs relay          # the one-time admin password
```

### systemd service

```bash
sudo useradd --system --home-dir /var/lib/termexo-relay --create-home termexo-relay
```

```ini
# /etc/systemd/system/termexo-relay.service
[Unit]
Description=Termexo relay
After=network-online.target
Wants=network-online.target

[Service]
User=termexo-relay
Group=termexo-relay
WorkingDirectory=/var/lib/termexo-relay
Environment=TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay
Environment=TERMEXO_RELAY_LISTEN=127.0.0.1:8443
Environment=TERMEXO_RELAY_PUBLIC_URL=https://relay.example.com
Environment=TERMEXO_RELAY_TLS=off
Environment=TERMEXO_RELAY_TRUSTED_PROXY=127.0.0.1/32
ExecStart=/usr/local/bin/termexo-relay serve
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now termexo-relay
journalctl -u termexo-relay -e      # the one-time admin password
```

Set `TERMEXO_RELAY_DATA_DIR` (or `WorkingDirectory`) explicitly: with neither, the relative default
`relay-data` resolves against `/`.

### Subdomain addresses

Give every device its own host name, such as `https://3f9c2a.relay.example.com/`.

1. Add a **wildcard DNS record**: `*.relay.example.com` pointing at the relay (keep the record for
   `relay.example.com` itself).
2. Get a **wildcard certificate**. With Caddy this needs the DNS-01 challenge and the matching DNS
   plugin, for example Cloudflare:

   ```caddyfile
   relay.example.com, *.relay.example.com {
       tls {
           dns cloudflare {env.CLOUDFLARE_API_TOKEN}
       }
       reverse_proxy 127.0.0.1:8443
   }
   ```

3. Start the relay with `--subdomain-base`:

   ```bash
   termexo-relay serve --tls off --listen 127.0.0.1:8443 \
     --public-url https://relay.example.com \
     --trusted-proxy 127.0.0.1/32 \
     --subdomain-base relay.example.com
   ```

What changes:

- Both entrances stay valid, so path-form links already handed out keep working.
- The addresses the relay hands out (the console's access address, the desktop's address list, what it
  announces upstream) switch to the subdomain form.
- `/console/*`, `/api/*` and `/tunnel` are served only on the base host; everything on a device
  subdomain is forwarded to the device.
- Host matching ignores case and port, and accepts **exactly one** label, which must be a valid device
  id. Any other host falls back to normal routing.
- With `--tls self-signed` the certificate gains `*.relay.example.com`; an existing certificate is not
  re-issued, so delete `<data-dir>/tls/` and restart (and re-pin on the desktops).
- A device with `access = relay-login` is redirected to its path form on the subdomain entrance: the
  console session cookie is host-only and never reaches device subdomains.

### Chaining relays

A relay can join another relay the way a desktop does. Typical use: an office relay on the LAN that
also makes its desktops reachable through a public relay.

```
 phone ──▶ relay-a.example.com (public) ──▶ office relay (LAN) ──▶ desktops
```

1. On the **upstream** (`relay-a`), issue an enrolment code of kind `relay`:

   ```bash
   curl -X POST https://relay-a.example.com/api/admin/enrollments \
     -H 'Content-Type: application/json' \
     -H 'X-Requested-With: termexo-console' \
     -b cookies.txt \
     -d '{"kind":"relay","ttlMinutes":30,"note":"office relay"}'
   ```

2. On the **downstream** (the office relay), link and restart:

   ```bash
   termexo-relay link --data-dir /var/lib/termexo-relay \
     --upstream https://relay-a.example.com \
     --code ABCD-EFGH-JKLM \
     --name office-relay
   sudo systemctl restart termexo-relay
   ```

   The console's **Relays** page does the same without a restart, as does the API:

   ```bash
   curl -X POST https://office-relay.lan:8443/api/admin/relays/upstream \
     --cacert /var/lib/termexo-relay/tls/cert.pem \
     -H 'Content-Type: application/json' \
     -H 'X-Requested-With: termexo-console' \
     -b cookies.txt \
     -d '{"url":"https://relay-a.example.com","code":"ABCD-EFGH-JKLM"}'

   # Leave the upstream again
   curl -X DELETE https://office-relay.lan:8443/api/admin/relays/upstream \
     --cacert /var/lib/termexo-relay/tls/cert.pem \
     -H 'X-Requested-With: termexo-console' -b cookies.txt
   ```

Trust runs one way: the upstream sees the downstream's devices and can drop the streams passing
through it, but it cannot see the downstream's users or revoke its devices. A device announced from
downstream has no row on the upstream, so its access policy is the one set on the relay it is
directly enrolled with (`PATCH` on the upstream answers 404). Loops are refused.

## Operating the relay

### The first administrator

When the database has no users, the relay creates `admin` and prints a one-time random password to
standard output — **only once** (see [Quick start](#quick-start-a-relay-on-your-lan-in-one-minute)).
Lost it? Use [`admin reset-password`](#admin-reset-password).

### Calling the API with curl

The console is a client of `/api/*`, so everything it does can be scripted. Two rules:

- Sign in once and keep the session cookie (`termexo_relay_session`, valid for 7 days).
- Every request other than `GET`, `HEAD` and `OPTIONS` must carry `X-Requested-With: termexo-console`.

```bash
RELAY=https://relay.example.com

# Sign in and save the cookie
curl -c cookies.txt -X POST "$RELAY/api/auth/login" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"username":"admin","password":"K7QD3MTR9WXF2HJN"}'

# Who am I
curl -b cookies.txt "$RELAY/api/me"

# Change my password
curl -b cookies.txt -X POST "$RELAY/api/me/password" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"currentPassword":"K7QD3MTR9WXF2HJN","newPassword":"a-long-new-password"}'

# Sign out
curl -b cookies.txt -X POST "$RELAY/api/auth/logout" -H 'X-Requested-With: termexo-console'
```

For a self-signed relay, trust its certificate explicitly instead of turning verification off:

```bash
curl --cacert /var/lib/termexo-relay/tls/cert.pem https://192.168.1.20:8443/api/health
```

Five failed sign-ins from one address within 10 minutes lock that address out for 10 minutes.

### Onboarding a desktop

**With an enrolment code** — the administrator issues it, the desktop user types it in. Console:
**Enrolment codes**. API:

```bash
# A desktop code, valid for 15 minutes (the default)
curl -b cookies.txt -X POST "$RELAY/api/admin/enrollments" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"kind":"desktop"}'

# Valid for 24 hours (the maximum), owned by an existing user, with a note
curl -b cookies.txt -X POST "$RELAY/api/admin/enrollments" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"kind":"desktop","ttlMinutes":1440,"ownerUserId":"<user id>","note":"Alice laptop"}'

# List codes, and cancel one that was never used
curl -b cookies.txt "$RELAY/api/admin/enrollments"
curl -b cookies.txt -X DELETE "$RELAY/api/admin/enrollments/<enrollment id>" \
  -H 'X-Requested-With: termexo-console'
```

| Field | Values | Default |
| --- | --- | --- |
| `kind` | `desktop` for a Termexo desktop, `relay` for a downstream relay | required |
| `ttlMinutes` | 1 to 1440; values outside are clamped | 15 |
| `ownerUserId` | the id of a console account (from `GET /api/admin/users`); that user then manages the device | none — only administrators manage it |
| `note` | up to 200 characters | none |

The response contains `code`, such as `ABCD-EFGH-JKLM`. It appears **in that response only** — the
database stores its SHA-256 — and it works once. On the desktop: **Settings → Remote access → Access
through a relay → How to join: Enrolment code**.

**With a relay account** — the desktop user signs in with their own console username and password
instead (**How to join: Relay account**). The device then belongs to that account. The password is
used for that one request and never stored on the desktop.

### Accounts for teammates

Console: **Users**. An `admin` manages everything; a `user` sees only their own devices and
their own password.

```bash
# Create a user
curl -b cookies.txt -X POST "$RELAY/api/admin/users" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"username":"alice","password":"an-initial-password","role":"user"}'

# List users (their ids are needed for ownerUserId)
curl -b cookies.txt "$RELAY/api/admin/users"

# Promote, disable, or set a new password — any subset of the three fields
curl -b cookies.txt -X PATCH "$RELAY/api/admin/users/<user id>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"role":"admin"}'
curl -b cookies.txt -X PATCH "$RELAY/api/admin/users/<user id>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"disabled":true}'

# Delete a user
curl -b cookies.txt -X DELETE "$RELAY/api/admin/users/<user id>" \
  -H 'X-Requested-With: termexo-console'
```

Disabling or deleting a user also revokes every device they own, and those tunnels close at once.

### Who can reach a device

Each device has an `access` value that decides who may **reach** it:

| Value | Behaviour |
| --- | --- |
| `public` (default) | Anyone with the `/d/<deviceId>/` link reaches it; the desktop's access token still decides what they can do |
| `relay-login` | The browser must be signed in to the relay as the device's **owner** or an **administrator** before anything is forwarded |

`relay-login` covers **every** request to the device — the page, its assets and the `/ws` upgrade.
Signed-out browsers get a 302 to `/console/login?next=<original path>` and come back after signing in;
signed-in browsers without the right get a 403 page. A stranger cannot even learn whether the device is
online.

Console: **Devices** → open the device → tick **Require a relay sign-in before reaching this device**. API:

```bash
# As an administrator, for any device
curl -b cookies.txt -X PATCH "$RELAY/api/admin/devices/<deviceId>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"access":"relay-login"}'

# As the owner, for your own device (the name can be changed at the same time)
curl -b cookies.txt -X PATCH "$RELAY/api/devices/<deviceId>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"access":"public","name":"Desk PC at home"}'

# Administrators can also edit the note
curl -b cookies.txt -X PATCH "$RELAY/api/admin/devices/<deviceId>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"note":"third floor, left desk"}'
```

### Revoking or disconnecting a device

```bash
# List devices: all of them as an admin, or only your own
curl -b cookies.txt "$RELAY/api/admin/devices"
curl -b cookies.txt "$RELAY/api/devices"

# Revoke: takes effect at once and for good — the live tunnel closes and the desktop must enrol again
curl -b cookies.txt -X POST "$RELAY/api/admin/devices/<deviceId>/revoke" \
  -H 'X-Requested-With: termexo-console'
curl -b cookies.txt -X POST "$RELAY/api/devices/<deviceId>/revoke" \
  -H 'X-Requested-With: termexo-console'           # your own device

# Disconnect (admin only): drop the live tunnel without revoking anything
curl -b cookies.txt -X POST "$RELAY/api/admin/devices/<deviceId>/disconnect" \
  -H 'X-Requested-With: termexo-console'
```

A revoked desktop shows "Revoked" in its remote access panel.

### Audit log

Console: **Audit**. Sign-ins, enrolments, device and user changes are recorded — never
passwords, codes, credentials or fingerprints.

```bash
# The newest 100 events (the default page)
curl -b cookies.txt "$RELAY/api/admin/audit"

# 20 events
curl -b cookies.txt "$RELAY/api/admin/audit?limit=20"

# The page before event 4812, for paging back in time
curl -b cookies.txt "$RELAY/api/admin/audit?limit=100&before=4812"

# Everything that happened to one device or user
curl -b cookies.txt "$RELAY/api/admin/audit?targetId=<deviceId or user id>"
```

### Health checks and monitoring

`GET /api/health` needs no sign-in and reveals nothing a tunnel handshake would not:

```bash
curl -s https://relay.example.com/api/health
# {"version":"0.10.2","relayId":"…","protocol":1}
```

Point load balancer checks and uptime monitors at it. The container image has no `curl`, so run the
check from outside the container.

```bash
# As an administrator: the relay id, its public URL and version
curl -b cookies.txt "$RELAY/api/admin/settings"
```

Behind a reverse proxy, also open the plain HTTP address once after deploying and after every change to
the proxy configuration:

```bash
curl -sI http://relay.example.com/api/health
# expect a 3xx redirect with Location: https://relay.example.com/api/health
```

Requests on port 80 never reach the relay. If the proxy loses its redirect, anyone typing the address
without `https://` gets the proxy's 404 or a refused connection, and neither `/api/health` over HTTPS nor
the relay's logs will show it.

### Upgrading and backing up

```bash
# Binary: replace it and restart
sudo install -m 0755 termexo-relay /usr/local/bin/termexo-relay
sudo systemctl restart termexo-relay

# Container
docker pull ghcr.io/gemron/termexo-relay:0.10.2
docker rm -f termexo-relay && docker run -d --name termexo-relay …   # same options as before

# Back up: stop, copy the data directory, start
sudo systemctl stop termexo-relay
sudo tar -czf termexo-relay-backup.tar.gz -C /var/lib termexo-relay
sudo systemctl start termexo-relay
```

Schema migrations run automatically on start and are safe to re-run. Desktops reconnect on their own
after a restart; their credentials survive it.

## Data directory and permissions

The relay is an unattended service with no keyring: console session tokens, SHA-256 digests of device
secrets, argon2 password hashes, the audit log and the private key generated by
`--tls self-signed` are protected by file permissions alone. So on every start (`serve` and `link`
alike) the relay narrows

- `<data-dir>/` and `<data-dir>/tls/` to `0700`;
- `<data-dir>/relay.db` and `<data-dir>/tls/key.pem` to `0600`.

`cert.pem` is public and left alone; SQLite's `-wal` / `-shm` files are covered by the `0700`
directory. Narrowing only ever **removes** group and other permissions — a stricter mode you set
yourself (a key at `0400`, say) is kept, correct modes are not rewritten, and a data directory from an
older version is fixed on its next start. A file system without mode bits gets a warning, not a failed
start. Nothing is changed on Windows, where files inherit the directory's ACL.

> After narrowing, only **the user running the relay** can read the data directory. Run
> `chown -R` first when you change the container UID, switch service accounts or point a backup job at
> the directory.

## Stopping

On Unix the relay listens for **SIGTERM** and **SIGINT**; `docker stop`, `systemctl stop` and a
Kubernetes eviction all send SIGTERM. The relay then

1. stops accepting new HTTP connections and gives requests in flight up to 5 seconds;
2. drops its link to an upstream relay, if any, so the upstream answers "device offline" at once
   instead of routing into a process on its way out. The credential is kept and the link comes back
   after a restart.

Device tunnels are long-lived, so with devices online this usually takes the full 5 seconds. The
default grace periods — Docker 10 s, systemd 90 s, Kubernetes 30 s — are all enough. The log names the
signal that stopped it.

On Windows only Ctrl-C is handled; Windows is for development, Linux is the deployment target.

## Development

```bash
cargo test                       # unit tests and the integration suites in tests/
cargo test relay_access          # one test or suite by name
cargo clippy --all-targets
cargo fmt
```

The console is a separate Angular workspace in `console/`:

```bash
npm --prefix console install
npm --prefix console test -- --watch=false
npm --prefix console run build   # -> console/dist/relay-console/browser
```

`build.rs` embeds the bundle through `include_dir`; without it the build falls back to
`console-placeholder/`, so `cargo test` never needs the front end.

Build your own image with the real console:

```bash
npm --prefix console install && npm --prefix console run build
docker build --build-arg CONSOLE_DIR=console/dist/relay-console/browser -t termexo-relay .
```

### Developing together with Termexo

`Cargo.toml` declares `termexo-relay-protocol` as a git dependency on the Termexo repository,
**pinned to a commit** — a branch is deleted once it merges, a commit is not.

Copy `.cargo/config.toml.example` to `.cargo/config.toml` to build against a Termexo checkout next to
this one:

```
devlop/
├── Termexo/
└── termexo-relay/
```

Protocol changes then compile here without pushing and re-pinning in between. The file is **not
committed**: cargo fails outright when a `paths` entry does not exist, so fresh clones, CI and the
Docker build must never see it.

It uses `paths` rather than `[patch]` on purpose. A patch rewrites the crate's source in `Cargo.lock` to
a local path, silently un-pinning the dependency on every local build, and committing such a lock breaks
every build without the override (CI, Docker, other clones). A `paths` override leaves the lock alone.

### Continuous integration and releases

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR | `cargo fmt --check`, `clippy -D warnings` and `cargo test --locked` on Linux x64, macOS ARM64 and Windows x64; console tests, build and `prettier --check` in a fourth job |
| `.github/workflows/release.yml` | `v*` tag, manual | Builds and packages the eight targets, each on a runner of its own architecture, writes `SHA256SUMS` and creates the release |
| `.github/workflows/docker.yml` | push to `main`, `v*` tag, manual | Builds amd64 and arm64 images on native runners, pushes them by digest and joins them into one manifest list on ghcr.io |

Nothing is cross-compiled: `aws-lc-rs` and the bundled SQLite both compile C, and cross toolchains cost
more than another runner. The console is built once and shared with every runner, so every archive
embeds the same console.

The version is kept in `Cargo.toml` and `console/package.json` and follows the Termexo version it
speaks to; `release.yml` refuses to build when they disagree or the tag does not match. To release:

```bash
git tag v0.10.2
git push origin v0.10.2
```

## Known limitations

- **No built-in ACME.** Issuing a certificate needs a publicly reachable domain to pass validation. On
  the internet, put the relay behind Caddy or a similar proxy with `--tls off`; on a LAN, use
  `--tls self-signed` with fingerprint pinning.
- All traffic passes through the relay; there is no direct path. Terminal content is end-to-end
  encrypted, but the operator of every relay on the path still knows when your devices are online,
  which addresses open them, and can disconnect them. Keep that in mind before joining an upstream
  relay someone else runs.
- Subdomain addresses need wildcard DNS and a wildcard certificate; a certificate generated by
  `--tls self-signed` is not re-issued when `--subdomain-base` is added later.
- A renewed certificate loaded with `--tls cert:` takes effect after a restart.
- A desktop can join one relay at a time; several relays for redundancy are not supported yet.
